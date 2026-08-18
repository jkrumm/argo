import { describe, expect, it } from 'bun:test'
import { crc32, inflateSync } from 'node:zlib'
import { encodeRgbPng } from './png.js'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Walk the chunk list: [length BE u32][type][data][crc BE u32], starting after the 8-byte signature. */
function chunks(png: Uint8Array): { type: string; data: Uint8Array; crcValid: boolean }[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const out: { type: string; data: Uint8Array; crcValid: boolean }[] = []
  let at = 8
  while (at < png.length) {
    const length = view.getUint32(at, false)
    const type = new TextDecoder().decode(png.subarray(at + 4, at + 8))
    const data = png.subarray(at + 8, at + 8 + length)
    const stored = view.getUint32(at + 8 + length, false)
    const computed = crc32(png.subarray(at + 4, at + 8 + length)) >>> 0
    out.push({ type, data, crcValid: stored === computed })
    at += 12 + length
  }
  return out
}

function rowsOf(pixels: number[][]): Uint8Array[] {
  return pixels.map((row) => Uint8Array.from(row))
}

describe('encodeRgbPng', () => {
  const rows = rowsOf([
    [255, 0, 0, 0, 255, 0],
    [0, 0, 255, 1, 2, 3],
  ])

  it('starts with the PNG signature', () => {
    const png = encodeRgbPng({ width: 2, height: 2, rows })
    expect([...png.subarray(0, 8)]).toEqual(SIGNATURE)
  })

  it('emits IHDR, IDAT and IEND in order, each with a valid CRC', () => {
    const parsed = chunks(encodeRgbPng({ width: 2, height: 2, rows }))
    expect(parsed.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
    expect(parsed.every((c) => c.crcValid)).toBe(true)
    expect(parsed[2]?.data.length).toBe(0)
  })

  it('describes itself as 8-bit truecolour with no interlacing', () => {
    const parsed = chunks(encodeRgbPng({ width: 2, height: 2, rows }))
    const ihdr = parsed[0]?.data
    expect(ihdr).toBeDefined()
    const view = new DataView(ihdr!.buffer, ihdr!.byteOffset, ihdr!.byteLength)
    expect(view.getUint32(0, false)).toBe(2) // width
    expect(view.getUint32(4, false)).toBe(2) // height
    expect([...ihdr!.subarray(8)]).toEqual([8, 2, 0, 0, 0]) // depth, colour type, compression, filter, interlace
  })

  it('round-trips the exact scanlines through inflate, each behind a 0x00 filter byte', () => {
    const png = encodeRgbPng({ width: 2, height: 2, rows })
    const idat = chunks(png).find((c) => c.type === 'IDAT')
    expect(idat).toBeDefined()
    const raw = new Uint8Array(inflateSync(idat!.data))
    expect(raw.length).toBe(2 * (1 + 6))
    expect([...raw]).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 1, 2, 3])
  })

  it('throws on a row whose length is not width*3 — a short row silently corrupts every later pixel', () => {
    expect(() =>
      encodeRgbPng({ width: 2, height: 2, rows: [rows[0]!, Uint8Array.from([1, 2, 3])] }),
    ).toThrow(TypeError)
  })

  it('throws when the row count disagrees with the declared height', () => {
    expect(() => encodeRgbPng({ width: 2, height: 3, rows })).toThrow(TypeError)
  })

  it('encodes a wide row without truncating it', () => {
    const width = 256
    const row = new Uint8Array(width * 3).fill(7)
    const png = encodeRgbPng({ width, height: 1, rows: [row] })
    const idat = chunks(png).find((c) => c.type === 'IDAT')
    const raw = new Uint8Array(inflateSync(idat!.data))
    expect(raw.length).toBe(1 + width * 3)
    expect(raw[0]).toBe(0)
    expect(raw.subarray(1).every((b) => b === 7)).toBe(true)
  })
})
