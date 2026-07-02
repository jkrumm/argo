import { describe, it, expect } from 'bun:test'
import { hashScript, serveAudioBytes } from './audio-cache.js'

// Pure unit tests — no disk I/O needed.

describe('hashScript()', () => {
  it('returns a 64-char lowercase hex string', () => {
    const h = hashScript('hello world')
    expect(h).toHaveLength(64)
    expect(h).toMatch(/^[a-f0-9]{64}$/)
  })

  it('is deterministic — same input always yields same hash', () => {
    const script = 'This is a podcast script.'
    expect(hashScript(script)).toBe(hashScript(script))
  })

  it('differs for different inputs', () => {
    expect(hashScript('a')).not.toBe(hashScript('b'))
  })

  it('is stable (known sha256 value)', () => {
    // sha256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(hashScript('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('serveAudioBytes() — no Range header', () => {
  const bytes = new Uint8Array([10, 20, 30, 40, 50])

  it('returns 200 with full bytes', async () => {
    const res = serveAudioBytes(bytes, null)
    expect(res.status).toBe(200)
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf).toEqual(bytes)
  })

  it('sets Content-Type audio/mpeg', () => {
    const res = serveAudioBytes(bytes, null)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
  })

  it('sets Accept-Ranges: bytes', () => {
    const res = serveAudioBytes(bytes, null)
    expect(res.headers.get('accept-ranges')).toBe('bytes')
  })

  it('sets Cache-Control immutable', () => {
    const res = serveAudioBytes(bytes, null)
    expect(res.headers.get('cache-control')).toContain('immutable')
  })

  it('sets Content-Length to byte count', () => {
    const res = serveAudioBytes(bytes, null)
    expect(res.headers.get('content-length')).toBe(String(bytes.length))
  })
})

describe('serveAudioBytes() — Range header (206)', () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])

  it('returns 206 for a valid start-end range', async () => {
    const res = serveAudioBytes(bytes, 'bytes=0-1')
    expect(res.status).toBe(206)
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf).toEqual(new Uint8Array([0, 1]))
    expect(res.headers.get('content-range')).toBe('bytes 0-1/10')
    expect(res.headers.get('content-length')).toBe('2')
  })

  it('clamps end to last byte index when end is beyond size', async () => {
    const res = serveAudioBytes(bytes, 'bytes=8-999')
    expect(res.status).toBe(206)
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf).toEqual(new Uint8Array([8, 9]))
    expect(res.headers.get('content-range')).toBe('bytes 8-9/10')
  })

  it('returns 206 for open-end range (bytes=5-)', async () => {
    const res = serveAudioBytes(bytes, 'bytes=5-')
    expect(res.status).toBe(206)
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf).toEqual(new Uint8Array([5, 6, 7, 8, 9]))
    expect(res.headers.get('content-range')).toBe('bytes 5-9/10')
  })

  it('returns 206 for suffix range (bytes=-3)', async () => {
    const res = serveAudioBytes(bytes, 'bytes=-3')
    expect(res.status).toBe(206)
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf).toEqual(new Uint8Array([7, 8, 9]))
    expect(res.headers.get('content-range')).toBe('bytes 7-9/10')
  })
})

describe('serveAudioBytes() — 416 unsatisfiable', () => {
  const bytes = new Uint8Array([0, 1, 2])

  it('returns 416 when start equals size', () => {
    const res = serveAudioBytes(bytes, 'bytes=3-')
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */3')
  })

  it('returns 416 when start exceeds size', () => {
    const res = serveAudioBytes(bytes, 'bytes=100-200')
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */3')
  })
})
