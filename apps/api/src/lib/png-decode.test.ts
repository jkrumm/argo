import { describe, expect, it } from 'bun:test'
import { decodePng } from './png-decode.js'
import { encodeRgbPng } from './png.js'

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const out = new Uint8Array(4 + 4 + typeBytes.length + data.length + 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length, false)
  out.set(typeBytes, 4)
  out.set(data, 4 + typeBytes.length)
  // decodePng never validates the trailing CRC, so a zeroed one is fine here.
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const part of parts) total += part.length
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/**
 * A minimal IHDR-only PNG (no IDAT needed): `decodePng` throws while still
 * parsing IHDR for every case this file exercises, so the bytes after it are
 * never reached.
 */
function ihdrOnlyPng(overrides: {
  bitDepth?: number
  colourType?: number
  interlace?: number
}): Uint8Array {
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, 1, false) // width
  view.setUint32(4, 1, false) // height
  ihdr[8] = overrides.bitDepth ?? 8
  ihdr[9] = overrides.colourType ?? 2
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter method
  ihdr[12] = overrides.interlace ?? 0
  return concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IEND', new Uint8Array(0))])
}

describe('decodePng', () => {
  it('round-trips exact pixel bytes through the encoder in ./png.ts', () => {
    const rows = [
      Uint8Array.from([255, 0, 0, 0, 255, 0, 10, 20, 30]),
      Uint8Array.from([0, 0, 255, 1, 2, 3, 250, 240, 230]),
    ]
    const png = encodeRgbPng({ width: 3, height: 2, rows })
    const decoded = decodePng(png)

    expect(decoded.width).toBe(3)
    expect(decoded.height).toBe(2)
    expect([...decoded.rgb]).toEqual([...rows[0]!, ...rows[1]!])
  })

  it('round-trips a wide image using more than the `None` filter path', () => {
    // A gradient gives deflate a reason to pick a non-zero filter per scanline,
    // exercising the Sub/Up/Average/Paeth predictors the flat png.test.ts
    // fixtures never touch.
    const width = 64
    const height = 8
    const rows: Uint8Array[] = []
    for (let y = 0; y < height; y++) {
      const row = new Uint8Array(width * 3)
      for (let x = 0; x < width; x++) {
        row[x * 3] = (x * 4) & 0xff
        row[x * 3 + 1] = (y * 30) & 0xff
        row[x * 3 + 2] = (x + y) & 0xff
      }
      rows.push(row)
    }
    const decoded = decodePng(encodeRgbPng({ width, height, rows }))
    expect([...decoded.rgb]).toEqual(rows.flatMap((row) => [...row]))
  })

  it('throws on a bit depth other than 8', () => {
    expect(() => decodePng(ihdrOnlyPng({ bitDepth: 16 }))).toThrow(/bit depth/)
    expect(() => decodePng(ihdrOnlyPng({ bitDepth: 1 }))).toThrow(/bit depth/)
  })

  it('throws on a palette colour type', () => {
    expect(() => decodePng(ihdrOnlyPng({ colourType: 3 }))).toThrow(/colour type/)
  })

  it('throws on a greyscale colour type', () => {
    expect(() => decodePng(ihdrOnlyPng({ colourType: 0 }))).toThrow(/colour type/)
    // Greyscale+alpha is also outside the RGB/RGBA envelope this decoder covers.
    expect(() => decodePng(ihdrOnlyPng({ colourType: 4 }))).toThrow(/colour type/)
  })

  it('throws on an interlaced PNG', () => {
    expect(() => decodePng(ihdrOnlyPng({ interlace: 1 }))).toThrow(/interlac/)
  })

  it('throws on a byte sequence that is not a PNG at all', () => {
    expect(() => decodePng(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/signature/)
  })
})
