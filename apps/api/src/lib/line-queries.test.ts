import { describe, expect, it } from 'bun:test'
import type { ChParams, ClickHouse } from '../clients/clickhouse.js'
import {
  LINE_SQL,
  PROBE_TARGETS,
  STALE_AFTER_S,
  latencyByTarget,
  lineNow,
  routerLine,
  speedTests,
  uptime,
  windowRange,
} from './line-queries.js'

// DB-free: the query functions run against a recording fake of the ClickHouse client.

type Call = { name: string; sql: string; params: ChParams }

function fakeClickHouse(answer: (name: string) => unknown[]): ClickHouse & { calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    configured: true,
    async query<Row>(name: string, sql: string, params: ChParams = {}) {
      calls.push({ name, sql, params })
      return answer(name) as Row[]
    },
  }
}

const NOW = 1_794_986_800 // 2026-11-18

describe('every query', () => {
  it.each(Object.entries(LINE_SQL))(
    '%s filters on the time column, has a LIMIT, FORMAT JSON and no interpolated value',
    (_name, sql) => {
      expect(sql).toMatch(/(TimeUnix|TimestampTime) >= fromUnixTimestamp\(\{from:UInt32\}\)/)
      expect(sql).toMatch(/\bLIMIT (\d+|\{limit:UInt32\})\s/)
      expect(sql.trimEnd().endsWith('FORMAT JSON')).toBe(true)
      expect(sql).not.toContain('${')
    },
  )
})

describe('windowRange', () => {
  it('snaps from down to a bucket edge; 90d buckets are whole UTC days', () => {
    const r = windowRange('90d', NOW)
    expect(r.step).toBe(86_400)
    expect(r.from % 86_400).toBe(0)
    expect(r.from).toBeLessThanOrEqual(NOW - 90 * 86_400)
    expect(NOW - 90 * 86_400 - r.from).toBeLessThan(86_400)
    expect(r.to).toBe(NOW)
  })

  it('uses 5 min, 1 h and 6 h buckets for 24h, 7d and 30d', () => {
    expect(windowRange('24h', NOW).step).toBe(300)
    expect(windowRange('7d', NOW).step).toBe(3_600)
    expect(windowRange('30d', NOW).step).toBe(21_600)
  })
})

describe('latencyByTarget', () => {
  const rows = (name: string) =>
    name === 'line.latency'
      ? [
          { t: 1000, target: 'quad9', sent: 100, received: 99, rtt_median: 9.456 },
          { t: 1000, target: 'gateway', sent: 100, received: 100, rtt_median: 0.9 },
          { t: 4600, target: 'gateway', sent: 0, received: 0, rtt_median: null },
        ]
      : [
          { target: 'quad9', sent: 100, received: 99, rtt_median: 9.456 },
          { target: 'gateway', sent: 100, received: 100, rtt_median: 0.9 },
        ]

  it('orders targets gateway-first, derives loss from sums and rounds', async () => {
    const ch = fakeClickHouse(rows)
    const result = await latencyByTarget(ch, windowRange('7d', NOW))
    expect(result.targets.map((t) => t.target)).toEqual(['gateway', 'quad9'])
    expect(result.targets[0]?.scope).toBe('gateway')
    expect(result.targets[1]?.scope).toBe('wan')
    expect(result.targets[1]?.lossPct).toBe(1)
    expect(result.targets[1]?.rttMs).toBe(9.46)
    expect(result.targets[0]?.points).toEqual([
      { t: 1000, lossPct: 0, rttMs: 0.9 },
      { t: 4600, lossPct: null, rttMs: null },
    ])
  })

  it('passes only typed params from the range, never request text', async () => {
    const ch = fakeClickHouse(rows)
    const range = windowRange('24h', NOW)
    await latencyByTarget(ch, range)
    for (const call of ch.calls)
      expect(call.params).toEqual({ from: range.from, to: range.to, step: 300 })
  })

  it('knows the four probe targets', () => {
    expect([...PROBE_TARGETS]).toEqual(['gateway', 'cloudflare', 'google', 'quad9'])
  })
})

describe('uptime', () => {
  const range = windowRange('7d', NOW)
  const open = (opened: number, closed: number) => [{ scope: 'wan', opened, closed }]

  it('sums outage seconds, clips one straddling the window start and gives the percentage', async () => {
    const ch = fakeClickHouse((name) =>
      name === 'line.outages'
        ? [
            { ended: range.to - 1000, duration_s: 100 },
            { ended: range.from + 50, duration_s: 500 },
          ]
        : open(0, 0),
    )
    const result = await uptime(ch, range)
    expect(result.outages.map((o) => o.durationS)).toEqual([100, 50])
    expect(result.outages[1]?.start).toBe(range.from)
    expect(result.downtimeS).toBe(150)
    expect(result.uptimePct).toBe(Number((100 * (1 - 150 / (range.to - range.from))).toFixed(3)))
  })

  it('counts an open outage up to now, first in the list', async () => {
    const ch = fakeClickHouse((name) =>
      name === 'line.outages' ? [] : open(NOW - 600, NOW - 9000),
    )
    const result = await uptime(ch, range)
    expect(result.outages).toEqual([{ start: NOW - 600, end: NOW, durationS: 600, ongoing: true }])
    expect(result.downtimeS).toBe(600)
  })

  it('is 100 % with no outages and does not treat a closed outage as open', async () => {
    const ch = fakeClickHouse((name) => (name === 'line.outages' ? [] : open(NOW - 900, NOW - 600)))
    const result = await uptime(ch, range)
    expect(result.uptimePct).toBe(100)
    expect(result.outages).toEqual([])
  })
})

describe('routerLine and speedTests', () => {
  it('converts kbit/s to Mbit/s and keeps absent as null', async () => {
    const ch = fakeClickHouse(() => [
      { t: 1, sync_down: 813_463.59, sync_up: 226_066, noise_down: 6.07, noise_up: null },
    ])
    const result = await routerLine(ch, windowRange('7d', NOW))
    expect(result.points).toEqual([
      { t: 1, syncDownMbit: 813.5, syncUpMbit: 226.1, noiseDownDb: 6.1, noiseUpDb: null },
    ])
  })

  it('maps a speed-test run', async () => {
    const ch = fakeClickHouse(() => [{ t: 5, download: 478.84, upload: 86.56, ping: null }])
    const result = await speedTests(ch, windowRange('30d', NOW))
    expect(result.runs).toEqual([{ t: 5, downloadMbit: 478.8, uploadMbit: 86.6, pingMs: null }])
  })
})

describe('lineNow', () => {
  const base = (name: string): unknown[] => {
    switch (name) {
      case 'line.now.probe':
        return [{ t: NOW - 20 }]
      case 'line.outage.open':
        return [{ scope: 'wan', opened: 100, closed: 200 }]
      case 'line.now.outage':
        return [{ ended: 1_000, duration_s: 420 }]
      case 'line.now.router':
        return [
          { metric: 'line.router.sync_rate', direction: 'down', value: 813_000, t: NOW - 400 },
          { metric: 'line.router.sync_rate', direction: 'up', value: 226_000, t: NOW - 400 },
          { metric: 'line.router.noise_margin', direction: 'down', value: 6, t: NOW - 400 },
          { metric: 'line.router.noise_margin', direction: 'up', value: 6.1, t: NOW - 400 },
        ]
      default:
        return [
          { metric: 'line.speedtest.download', value: 480, t: NOW - 900 },
          { metric: 'line.speedtest.upload', value: 90, t: NOW - 900 },
          { metric: 'line.speedtest.ping', value: 5, t: NOW - 900 },
        ]
    }
  }

  it('is up with a fresh sample and no open outage, with the last outage and the newest readings', async () => {
    const now = await lineNow(fakeClickHouse(base), NOW)
    expect(now.state).toBe('up')
    expect(now.lastOutage).toEqual({ start: 580, end: 1000, durationS: 420 })
    expect(now.router).toEqual({
      at: NOW - 400,
      syncDownMbit: 813,
      syncUpMbit: 226,
      noiseDownDb: 6,
      noiseUpDb: 6.1,
    })
    expect(now.speedTest).toEqual({ at: NOW - 900, downloadMbit: 480, uploadMbit: 90, pingMs: 5 })
  })

  it('is stale, not up, when the newest sample is older than the threshold', async () => {
    const ch = fakeClickHouse((name) =>
      name === 'line.now.probe' ? [{ t: NOW - STALE_AFTER_S - 1 }] : base(name),
    )
    expect((await lineNow(ch, NOW)).state).toBe('stale')
  })

  it('is stale with no sample at all', async () => {
    const ch = fakeClickHouse((name) => (name === 'line.now.probe' ? [{ t: null }] : base(name)))
    const now = await lineNow(ch, NOW)
    expect(now.state).toBe('stale')
    expect(now.probeAt).toBeNull()
  })

  it('is down while an exported outage is open', async () => {
    const ch = fakeClickHouse((name) =>
      name === 'line.outage.open' ? [{ scope: 'wan', opened: NOW - 60, closed: 0 }] : base(name),
    )
    const now = await lineNow(ch, NOW)
    expect(now.state).toBe('down')
    expect(now.ongoingSince).toBe(NOW - 60)
  })

  it('has null router and speed test when the tables hold none', async () => {
    const ch = fakeClickHouse((name) =>
      name === 'line.now.router' || name === 'line.now.speedtest' ? [] : base(name),
    )
    const now = await lineNow(ch, NOW)
    expect(now.router).toBeNull()
    expect(now.speedTest).toBeNull()
  })
})
