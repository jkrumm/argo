/**
 * A minimal PNG writer — 8-bit truecolour only.
 *
 * This exists so `lp-tile.ts` can emit terrarium-encoded raster tiles without
 * an image dependency. That is the whole argument for it: `node:zlib` already
 * ships both halves a PNG encoder needs (`deflateSync` for IDAT, `crc32` for
 * every chunk's trailer), so a real encoder here would be ~40 lines of value
 * wrapped around a supply-chain surface we would then have to keep patched.
 *
 * Deliberately NOT general: no palette, no alpha, no interlacing, no 16-bit,
 * no filter types beyond `None`. The one caller writes RGB data where every
 * byte is meaningful, so the adaptive filters that make photographic PNGs small
 * would only cost CPU. Anything richer belongs in a library, not here.
 */

import { crc32, deflateSync } from 'node:zlib'

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Matches the reference encoder (`docs/poc/astro-map/lp-tiles-gen.py`, `zlib.compress(raw, 6)`). */
const DEFLATE_LEVEL = 6

/** Colour type 2 — truecolour RGB, 3 bytes per pixel, no alpha channel. */
const COLOUR_TYPE_RGB = 2
const BYTES_PER_PIXEL = 3

/** Every scanline is prefixed with its filter type; 0x00 is `None`. */
const FILTER_NONE = 0

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  // The CRC covers the type AND the data, but the length prefix is excluded.
  const body = new Uint8Array(typeBytes.length + data.length)
  body.set(typeBytes, 0)
  body.set(data, typeBytes.length)

  const out = new Uint8Array(4 + body.length + 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length, false)
  out.set(body, 4)
  view.setUint32(4 + body.length, crc32(body) >>> 0, false)
  return out
}

function ihdr(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13)
  const view = new DataView(data.buffer)
  view.setUint32(0, width, false)
  view.setUint32(4, height, false)
  data[8] = 8 // bit depth
  data[9] = COLOUR_TYPE_RGB
  data[10] = 0 // compression method — deflate, the only one defined
  data[11] = 0 // filter method — adaptive, the only one defined
  data[12] = 0 // interlace method — none
  return data
}

/**
 * Encode an 8-bit truecolour (RGB) PNG. `rows` must hold `height` entries of
 * exactly `width * 3` bytes.
 *
 * A short row is a `TypeError`, not a silent pad: PNG has no per-row length, so
 * a scanline that is one byte short shifts every following pixel and produces a
 * file that decodes without error into garbage. Failing here is the only place
 * the mistake is still cheap to find.
 */
export function encodeRgbPng(args: {
  width: number
  height: number
  rows: Uint8Array[]
  // `Uint8Array<ArrayBuffer>`, not a bare `Uint8Array`: the DOM lib's `BodyInit`
  // only accepts a view over a real `ArrayBuffer`, so the default
  // `ArrayBufferLike` parameter makes `new Response(png)` a type error in any
  // consumer compiled against lib.dom (the dashboard's typecheck sees this file
  // through the API's exported route types).
}): Uint8Array<ArrayBuffer> {
  const { width, height, rows } = args
  if (rows.length !== height) {
    throw new TypeError(`encodeRgbPng: expected ${height} rows, got ${rows.length}`)
  }

  const stride = width * BYTES_PER_PIXEL
  const raw = new Uint8Array(height * (1 + stride))
  for (const [index, row] of rows.entries()) {
    if (row.length !== stride) {
      throw new TypeError(`encodeRgbPng: row ${index} has ${row.length} bytes, expected ${stride}`)
    }
    const offset = index * (1 + stride)
    raw[offset] = FILTER_NONE
    raw.set(row, offset + 1)
  }

  const idat = new Uint8Array(deflateSync(raw, { level: DEFLATE_LEVEL }))
  const parts = [
    PNG_SIGNATURE,
    chunk('IHDR', ihdr(width, height)),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ]

  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const png = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    png.set(part, at)
    at += part.length
  }
  return png
}
