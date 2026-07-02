import { createHash } from 'node:crypto'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Content-addressed store for synthesized audio files.
 * Keys are sha256 hex strings; values are raw audio bytes (mp3).
 */
export interface AudioStore {
  has(hash: string): Promise<boolean>
  read(hash: string): Promise<Uint8Array | null>
  write(hash: string, bytes: Uint8Array): Promise<void>
}

/** sha256 of the raw UTF-8 script string, returned as a 64-char hex string. */
export function hashScript(script: string): string {
  return createHash('sha256').update(script, 'utf8').digest('hex')
}

/**
 * Disk-backed AudioStore. Files are stored as `<dir>/<hash>.mp3`.
 * The directory is created lazily on the first write.
 */
export function createDiskAudioStore(dir: string): AudioStore {
  function filePath(hash: string): string {
    return join(dir, `${hash}.mp3`)
  }

  return {
    async has(hash) {
      return existsSync(filePath(hash))
    },
    async read(hash) {
      const p = filePath(hash)
      if (!existsSync(p)) return null
      return new Uint8Array(readFileSync(p))
    },
    async write(hash, bytes) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(filePath(hash), bytes)
    },
  }
}

/**
 * Pure range-response builder — no I/O. Takes already-read bytes and an
 * optional `Range` header value, returns the appropriate Response:
 * - 200 full file (no `Range` header)
 * - 206 partial content (satisfiable range)
 * - 416 range not satisfiable (start >= size)
 */
export function serveAudioBytes(bytes: Uint8Array, rangeHeader: string | null): Response {
  const size = bytes.length
  const baseHeaders = {
    'Content-Type': 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
  }

  if (!rangeHeader) {
    // `.slice()` yields a fresh `Uint8Array<ArrayBuffer>` (non-shared buffer),
    // which is a valid `BodyInit` — passing the raw param (`Uint8Array<ArrayBufferLike>`)
    // is not, under TS 5.7's buffer-generic lib types.
    return new Response(bytes.slice(), {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Length': String(size),
      },
    })
  }

  // Parse `Range: bytes=START-END`, `bytes=START-`, `bytes=-N`
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)
  if (!match) {
    // Malformed range — treat as unsatisfiable
    return new Response(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes */${size}`,
      },
    })
  }

  const rawStart = match[1]
  const rawEnd = match[2]

  let start: number
  let end: number

  if (!rawStart && rawEnd) {
    // Suffix range: bytes=-N → last N bytes
    const suffix = parseInt(rawEnd, 10)
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = rawStart ? parseInt(rawStart, 10) : 0
    end = rawEnd ? parseInt(rawEnd, 10) : size - 1
  }

  // Clamp end to last valid byte index
  end = Math.min(end, size - 1)

  if (start >= size || start > end) {
    return new Response(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes */${size}`,
      },
    })
  }

  const slice = bytes.slice(start, end + 1)
  return new Response(slice, {
    status: 206,
    headers: {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(slice.length),
    },
  })
}
