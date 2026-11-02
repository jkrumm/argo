import { describe, it, expect } from 'bun:test'
import { createThrottle, parsePulledStats } from './reading-link.js'

describe('parsePulledStats', () => {
  it('accepts a good body and applies defaults', () => {
    const [row] = parsePulledStats('{"stats":[{"bookKey":"k1","title":"T","currentPercent":42}]}')
    expect(row?.bookKey).toBe('k1')
    expect(row?.currentPercent).toBe(42)
    expect(row?.sessions).toBe(0)
    expect(row?.author).toBeNull()
  })

  it('accepts an empty stats list', () => {
    expect(parsePulledStats('{"stats":[]}')).toEqual([])
  })

  it('rejects malformed JSON', () => {
    expect(() => parsePulledStats('not json')).toThrow(/valid JSON/)
  })

  it('rejects a wrong shape or invalid row', () => {
    expect(() => parsePulledStats('{"nope":[]}')).toThrow(/rejected/)
    expect(() => parsePulledStats('{"stats":[{"bookKey":"k","currentPercent":150}]}')).toThrow(
      /rejected/,
    )
  })

  it('rejects more than 1000 rows', () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ bookKey: `k${i}` }))
    expect(() => parsePulledStats(JSON.stringify({ stats: rows }))).toThrow(/rejected/)
  })
})

describe('createThrottle', () => {
  it('runs once per interval', async () => {
    let t = 0
    let calls = 0
    const run = createThrottle(
      async () => {
        calls += 1
        return true
      },
      300_000,
      () => t,
    )
    expect(await run()).toBe(true)
    t = 299_999
    expect(await run()).toBe(false)
    t = 300_000
    expect(await run()).toBe(true)
    expect(calls).toBe(2)
  })

  it('shares one in-flight run between concurrent callers', async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const run = createThrottle(
      async () => {
        calls += 1
        await gate
        return true
      },
      0,
      () => 0,
    )
    const results = [run(), run(), run()]
    release()
    expect(await Promise.all(results)).toEqual([true, false, false])
    expect(calls).toBe(1)
  })

  it('stays throttled after a failed run and never rejects', async () => {
    let calls = 0
    const run = createThrottle(
      async () => {
        calls += 1
        throw new Error('x')
      },
      300_000,
      () => 0,
    )
    expect(await run()).toBe(false)
    expect(await run()).toBe(false)
    expect(calls).toBe(1)
  })
})
