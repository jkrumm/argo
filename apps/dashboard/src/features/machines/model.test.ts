import { describe, expect, it } from 'bun:test'
import type { Machine } from '../../lib/queries/machines'
import {
  attention,
  formatMemory,
  formatRate,
  formatReporting,
  gapZones,
  loadPerCore,
  selectHost,
  statusLine,
  toneOf,
} from './model'

const machine = (over: Partial<Machine> = {}): Machine => ({
  host: 'vps',
  state: 'reporting',
  lastSeen: 1_000_000,
  reportingPct: 100,
  cores: 4,
  cpuPct: 20,
  memPct: 30,
  load1: 1,
  fullestFilesystem: { mount: '/', pct: 50 },
  netInBps: 0,
  netOutBps: 0,
  points: [],
  ...over,
})

describe('toneOf', () => {
  it('is quiet below warn, warn from warn, bad from bad, and quiet without a value', () => {
    const limits = { warn: 80, bad: 90 }
    expect(toneOf(79.9, limits)).toBeUndefined()
    expect(toneOf(80, limits)).toBe('warn')
    expect(toneOf(90, limits)).toBe('bad')
    expect(toneOf(null, limits)).toBeUndefined()
  })
})

describe('attention and selectHost', () => {
  const quiet = machine({ host: 'a' })
  const disk = machine({ host: 'b', fullestFilesystem: { mount: '/', pct: 85 } })
  const full = machine({ host: 'c', fullestFilesystem: { mount: '/', pct: 95 } })
  const silent = machine({ host: 'd', state: 'silent', cpuPct: null })

  it('ranks quiet < warning < bad < silent', () => {
    expect([quiet, disk, full, silent].map(attention)).toEqual([0, 1, 2, 3])
  })

  it('counts load per core, not the raw load', () => {
    expect(attention(machine({ load1: 5, cores: 12 }))).toBe(0)
    expect(attention(machine({ load1: 7, cores: 4 }))).toBe(1)
    expect(loadPerCore(null, 4)).toBeNull()
    expect(loadPerCore(2, 0)).toBeNull()
  })

  it('selects the picked machine when listed, else the one that most needs attention', () => {
    expect(selectHost([quiet, disk, silent], 'b')).toBe('b')
    expect(selectHost([quiet, disk, silent], '')).toBe('d')
    expect(selectHost([quiet, disk], 'gone')).toBe('b')
  })

  it('falls back to the first machine when all are quiet, and to nothing when there are none', () => {
    expect(selectHost([quiet, machine({ host: 'z' })], '')).toBe('a')
    expect(selectHost([], '')).toBeUndefined()
  })
})

describe('formatting', () => {
  it('writes rates with one unit of 1000', () => {
    expect(formatRate(null)).toBe('—')
    expect(formatRate(34)).toBe('34\u00a0B/s')
    expect(formatRate(340_000)).toBe('340\u00a0kB/s')
    expect(formatRate(1_234_567)).toBe('1.2\u00a0MB/s')
    expect(formatRate(36_180_182)).toBe('36\u00a0MB/s')
  })

  it('writes container memory in MiB, then GiB', () => {
    expect(formatMemory(null)).toBe('—')
    expect(formatMemory(110 * 1_048_576)).toBe('110\u00a0MiB')
    expect(formatMemory(1_295_548_416)).toBe('1.2\u00a0GiB')
  })

  it('never rounds a reporting share up to 100', () => {
    expect(formatReporting(99.96)).toBe('99.9')
    expect(formatReporting(100)).toBe('100')
    expect(formatReporting(null)).toBe('—')
  })
})

describe('statusLine', () => {
  const NOW = 1_000_000_000 + 3 * 3_600_000

  it('says reporting with its share for the range', () => {
    expect(statusLine(machine({ reportingPct: 99.84 }), '24h', NOW)).toBe(
      '99.8\u00a0% reporting\u00a0·\u00a024h',
    )
  })

  it('says silent with the age of the last sample', () => {
    const line = statusLine(
      machine({ state: 'silent', lastSeen: 1_000_000, reportingPct: 87.5 }),
      '24h',
      NOW,
    )
    expect(line.startsWith('silent')).toBe(true)
    expect(line).toContain('last seen 3\u00a0h ago')
  })

  it('is just "reporting" without a share', () => {
    expect(statusLine(machine({ reportingPct: null }), '1h', NOW)).toBe('reporting')
  })
})

describe('gapZones', () => {
  it('widens a gap too short to see on the axis, centred, and clips it to the axis', () => {
    const [zone] = gapZones([{ from: 1000, to: 1600 }], 0, 30 * 86_400, 'red')
    const width = (zone!.to.getTime() - zone!.from.getTime()) / 1000
    expect(width).toBeGreaterThan(600)
    expect(zone!.from.getTime() / 1000).toBeLessThan(1000)
    const [clipped] = gapZones([{ from: 10, to: 20 }], 0, 30 * 86_400, 'red')
    expect(clipped!.from.getTime()).toBe(0)
  })

  it('leaves a gap that is wide enough as it is', () => {
    const [zone] = gapZones([{ from: 1000, to: 4600 }], 0, 3600 * 2, 'red')
    expect(zone).toEqual({ from: new Date(1_000_000), to: new Date(4_600_000), fill: 'red' })
  })
})
