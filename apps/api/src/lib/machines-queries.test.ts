import { describe, expect, it } from 'bun:test'
import type { ChParams, ClickHouse } from '../clients/clickhouse.js'
import {
  MACHINES_SQL,
  SILENT_AFTER_S,
  counterRates,
  machineDetail,
  machineWindow,
  machinesOverview,
  reportingPct,
  silentGaps,
} from './machines-queries.js'

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
  it.each(Object.entries(MACHINES_SQL))(
    '%s filters on the time column, has a LIMIT, FORMAT JSON and no interpolated value',
    (_name, sql) => {
      expect(sql).toMatch(/TimeUnix >= fromUnixTimestamp\(\{from:UInt32\}\)/)
      expect(sql).toMatch(/\bLIMIT \d+\s/)
      expect(sql.trimEnd().endsWith('FORMAT JSON')).toBe(true)
      expect(sql).not.toContain('${')
    },
  )

  it('selects the newest sample time per bucket for the counter rates', () => {
    for (const sql of [MACHINES_SQL.NETWORK_SQL, MACHINES_SQL.DISK_IO_SQL])
      expect(sql).toContain('toUnixTimestamp(max(TimeUnix)) AS at')
  })

  it('pins the host agent and prod on every host query, and the host only as a placeholder', () => {
    for (const [name, sql] of Object.entries(MACHINES_SQL)) {
      if (name.startsWith('CONTAINER')) continue
      expect(sql).toContain("ServiceName = 'host-agent'")
      expect(sql).toContain("'deployment.environment.name'] = 'prod'")
    }
    for (const sql of [MACHINES_SQL.SERIES_SQL, MACHINES_SQL.NETWORK_SQL, MACHINES_SQL.NOW_SQL])
      expect(sql).toContain('{host:String}')
  })
})

describe('machineWindow', () => {
  it('snaps from down to a bucket edge', () => {
    for (const range of ['1h', '24h', '7d', '30d'] as const) {
      const w = machineWindow(range, NOW)
      expect(w.from % w.step).toBe(0)
      expect(NOW - w.from).toBeGreaterThanOrEqual(NOW - w.from - w.step)
      expect(w.to).toBe(NOW)
    }
  })

  it('keeps every series under 400 points: 1 min, 5 min, 30 min and 2 h buckets', () => {
    const points = (r: '1h' | '24h' | '7d' | '30d') => {
      const w = machineWindow(r, NOW)
      return (w.to - w.from) / w.step
    }
    expect(machineWindow('1h', NOW).step).toBe(60)
    expect(machineWindow('24h', NOW).step).toBe(300)
    expect(machineWindow('7d', NOW).step).toBe(1_800)
    expect(machineWindow('30d', NOW).step).toBe(7_200)
    for (const r of ['1h', '24h', '7d', '30d'] as const) expect(points(r)).toBeLessThan(400)
  })
})

describe('counterRates', () => {
  const row = (
    t: number,
    total: number,
    over: Partial<{ device: string; direction: string; at: number }> = {},
  ) => ({
    host: 'vps',
    t,
    at: over.at ?? t,
    device: over.device ?? 'eth0',
    direction: over.direction ?? 'receive',
    total,
  })
  const dirs = { in: 'receive', out: 'transmit' }

  it('is the rise over the elapsed time, first bucket without a rate', () => {
    const rates = counterRates([row(0, 1000), row(300, 4000), row(600, 4600)], 300, dirs)
    const h = rates.get('vps')
    expect(h?.get(0)).toBeUndefined()
    expect(h?.get(300)?.inBps).toBe(10)
    expect(h?.get(600)?.inBps).toBe(2)
    expect(h?.get(300)?.outBps).toBeNull()
  })

  it('sums devices and keeps directions apart', () => {
    const rates = counterRates(
      [
        row(0, 0),
        row(60, 600),
        row(0, 0, { device: 'eth1' }),
        row(60, 120, { device: 'eth1' }),
        row(0, 0, { direction: 'transmit' }),
        row(60, 60, { direction: 'transmit' }),
      ],
      60,
      dirs,
    )
    expect(rates.get('vps')?.get(60)).toEqual({ t: 60, inBps: 12, outBps: 1 })
  })

  it('treats a counter reset as a gap, never a spike', () => {
    const rates = counterRates([row(0, 9000), row(300, 100), row(600, 400)], 300, dirs)
    const h = rates.get('vps')
    expect(h?.get(300)).toBeUndefined()
    expect(h?.get(600)?.inBps).toBe(1)
  })

  it('treats a hole of more than one empty bucket as a gap', () => {
    const rates = counterRates([row(0, 0), row(900, 90_000), row(1200, 90_300)], 300, dirs)
    const h = rates.get('vps')
    expect(h?.get(900)).toBeUndefined()
    expect(h?.get(1200)?.inBps).toBe(1)
  })

  it('divides by the time between the newest samples, so the bucket still filling is exact', () => {
    // the previous bucket's newest sample at 290, the current bucket (started 300) has one at 350
    const rates = counterRates([row(0, 0, { at: 290 }), row(300, 60_000, { at: 350 })], 300, dirs)
    expect(rates.get('vps')?.get(300)?.inBps).toBe(1000)
  })

  it('averages over one missing bucket instead of dropping it', () => {
    const rates = counterRates([row(0, 0), row(600, 6000)], 300, dirs)
    expect(rates.get('vps')?.get(600)?.inBps).toBe(10)
  })
})

describe('silentGaps and reportingPct', () => {
  it('finds stretches of at least 10 minutes between buckets with samples', () => {
    // buckets of 300 s at 0, 300, then 1800: empty from 600 to 1800
    expect(silentGaps([0, 300, 1800], 300, 1800, 1800 + 60)).toEqual([{ from: 600, to: 1800 }])
  })

  it('ignores a single missed 5 minute bucket', () => {
    expect(silentGaps([0, 600], 300, 600, 700)).toEqual([])
  })

  it('adds an open stretch from the last sample when the machine is silent now', () => {
    expect(silentGaps([0, 300], 300, 400, 400 + SILENT_AFTER_S)).toEqual([
      { from: 400, to: 400 + SILENT_AFTER_S },
    ])
    expect(silentGaps([0, 300], 300, 400, 400 + SILENT_AFTER_S - 1)).toEqual([])
  })

  it('reports the share of buckets with a sample since the first one', () => {
    expect(reportingPct([0, 300, 600, 900], 300, 1200)).toBe(100)
    expect(reportingPct([0, 300, 1500], 300, 1800)).toBe(50)
    expect(reportingPct([], 300, 1800)).toBeNull()
  })
})

const answers =
  (seen: number) =>
  (name: string): unknown[] => {
    switch (name) {
      case 'machines.last_seen':
        return [
          { host: 'vps', last_seen: NOW - 30 },
          { host: 'mini', last_seen: seen },
          { host: '', last_seen: NOW },
        ]
      case 'machines.series':
      case 'machines.detail.series':
        return [
          { host: 'mini', t: NOW - 600, idle: 0.9, mem_used: 0.5, load1: 1 },
          { host: 'mini', t: NOW - 300, idle: 0.75, mem_used: 0.6, load1: 2 },
          { host: 'vps', t: NOW - 300, idle: 0.5, mem_used: 0.25, load1: 3 },
        ]
      case 'machines.now':
        return [
          { host: 'mini', idle: 0.7, mem_used: 0.63, load1: 5.338 },
          { host: 'vps', idle: 0.4681, mem_used: 0.3245, load1: 6.1625 },
        ]
      case 'machines.cores':
        return [
          { host: 'mini', cores: 12 },
          { host: 'vps', cores: 4 },
        ]
      case 'machines.filesystems':
      case 'machines.detail.filesystems':
        return [
          { host: 'mini', mount: '/System/Volumes/Data', fs_type: 'apfs', used: 0.847 },
          { host: 'mini', mount: '/Volumes/EXT', fs_type: 'apfs', used: 0.6 },
          { host: 'vps', mount: '/', fs_type: 'ext4', used: 0.7169 },
        ]
      case 'machines.network':
      case 'machines.detail.network':
        return [
          {
            host: 'vps',
            t: NOW - 600,
            at: NOW - 600,
            device: 'eth0',
            direction: 'receive',
            total: 0,
          },
          {
            host: 'vps',
            t: NOW - 300,
            at: NOW - 300,
            device: 'eth0',
            direction: 'receive',
            total: 3000,
          },
          {
            host: 'vps',
            t: NOW - 600,
            at: NOW - 600,
            device: 'eth0',
            direction: 'transmit',
            total: 0,
          },
          {
            host: 'vps',
            t: NOW - 300,
            at: NOW - 300,
            device: 'eth0',
            direction: 'transmit',
            total: 600,
          },
        ]
      case 'machines.detail.disk':
        return [
          { host: 'vps', t: NOW - 600, at: NOW - 600, device: 'sda', direction: 'read', total: 0 },
          {
            host: 'vps',
            t: NOW - 300,
            at: NOW - 300,
            device: 'sda',
            direction: 'read',
            total: 30_000,
          },
          { host: 'vps', t: NOW - 600, at: NOW - 600, device: 'sda', direction: 'write', total: 0 },
          {
            host: 'vps',
            t: NOW - 300,
            at: NOW - 300,
            device: 'sda',
            direction: 'write',
            total: 3_000,
          },
        ]
      case 'machines.detail.container_cpu':
        return [
          { name: 'redis', cpu: 0.8812 },
          { name: 'postgres', cpu: 1.374 },
          { name: 'idle', cpu: 0 },
          { name: 'a', cpu: 0.1 },
          { name: 'b', cpu: 0.1 },
          { name: 'c', cpu: 0.1 },
          { name: 'd', cpu: 0.1 },
        ]
      case 'machines.detail.container_memory':
        return [{ name: 'postgres', memory: 123_456_789.4 }]
      default:
        return []
    }
  }

describe('machinesOverview', () => {
  it('lists every host of the last 24 h by name, skipping an empty host.name', async () => {
    const ch = fakeClickHouse(answers(NOW - 40))
    const result = await machinesOverview(ch, machineWindow('24h', NOW))
    expect(result.machines.map((m) => m.host)).toEqual(['mini', 'vps'])
    const lastSeen = ch.calls.find((c) => c.name === 'machines.last_seen')
    expect(lastSeen?.params['from']).toBe(NOW - 86_400)
  })

  it('derives CPU as 100 x (1 - idle), memory from used, and the fullest mount', async () => {
    const ch = fakeClickHouse(answers(NOW - 40))
    const mini = (await machinesOverview(ch, machineWindow('24h', NOW))).machines[0]
    expect(mini?.state).toBe('reporting')
    expect(mini?.cpuPct).toBe(30)
    expect(mini?.memPct).toBe(63)
    expect(mini?.load1).toBe(5.34)
    expect(mini?.cores).toBe(12)
    expect(mini?.fullestFilesystem).toEqual({ mount: '/System/Volumes/Data', pct: 84.7 })
    expect(mini?.points.map((p) => p.cpuPct)).toEqual([10, 25])
  })

  it('attaches network rates to the series and the newest one to the row', async () => {
    const ch = fakeClickHouse(answers(NOW - 40))
    const vps = (await machinesOverview(ch, machineWindow('24h', NOW))).machines[1]
    expect(vps?.netInBps).toBe(10)
    expect(vps?.netOutBps).toBe(2)
    expect(vps?.points[0]).toMatchObject({ t: NOW - 300, netInBps: 10, netOutBps: 2 })
  })

  it('shows a machine with no sample for 10 minutes as silent: null values, never zero', async () => {
    const ch = fakeClickHouse(answers(NOW - SILENT_AFTER_S))
    const mini = (await machinesOverview(ch, machineWindow('24h', NOW))).machines[0]
    expect(mini?.state).toBe('silent')
    expect(mini?.lastSeen).toBe(NOW - SILENT_AFTER_S)
    for (const key of [
      'cpuPct',
      'memPct',
      'load1',
      'cores',
      'fullestFilesystem',
      'netInBps',
    ] as const)
      expect(mini?.[key]).toBeNull()
    expect(mini?.points.length).toBe(2)
  })

  it('is still reporting one second inside the threshold', async () => {
    const ch = fakeClickHouse(answers(NOW - SILENT_AFTER_S + 1))
    expect((await machinesOverview(ch, machineWindow('24h', NOW))).machines[0]?.state).toBe(
      'reporting',
    )
  })

  it('reads every machine at once: the host placeholder is empty', async () => {
    const ch = fakeClickHouse(answers(NOW - 40))
    await machinesOverview(ch, machineWindow('7d', NOW))
    for (const call of ch.calls.filter((c) => c.name !== 'machines.last_seen'))
      expect(call.params['host']).toBe('')
  })

  it('reads the network from one bucket before the range so its first bucket has a rate', async () => {
    const ch = fakeClickHouse(answers(NOW - 40))
    const w = machineWindow('1h', NOW)
    await machinesOverview(ch, w)
    expect(ch.calls.find((c) => c.name === 'machines.network')?.params['from']).toBe(
      w.from - w.step,
    )
  })
})

describe('machineDetail', () => {
  it('is null for a host that has not reported in 24 h', async () => {
    const ch = fakeClickHouse(answers(NOW - 40))
    expect(await machineDetail(ch, 'nope', machineWindow('24h', NOW))).toBeNull()
  })

  it('joins series, disk IO and network rates and fills filesystems fullest first', async () => {
    const ch = fakeClickHouse(answers(NOW - 40))
    const d = await machineDetail(ch, 'vps', machineWindow('24h', NOW))
    expect(d?.state).toBe('reporting')
    expect(d?.points.at(-1)).toMatchObject({
      cpuPct: 50,
      memPct: 25,
      netInBps: 10,
      netOutBps: 2,
      diskReadBps: 100,
      diskWriteBps: 10,
    })
    expect(d?.filesystems).toEqual([{ mount: '/', type: 'ext4', pct: 71.7 }])
    for (const call of ch.calls.filter((c) => c.name !== 'machines.last_seen'))
      expect(call.params['host']).toBe('vps')
  })

  it('takes the top 6 containers by CPU with their memory, zero-CPU ones last', async () => {
    const ch = fakeClickHouse(answers(NOW - 40))
    const d = await machineDetail(ch, 'vps', machineWindow('24h', NOW))
    expect(d?.containers.map((c) => c.name)).toEqual(['postgres', 'redis', 'a', 'b', 'c', 'd'])
    expect(d?.containers[0]).toEqual({ name: 'postgres', cpuPct: 1.37, memBytes: 123_456_789 })
    expect(d?.containers[1]?.memBytes).toBeNull()
  })

  it('has no containers on a machine without Docker', async () => {
    const ch = fakeClickHouse((name) =>
      name.startsWith('machines.detail.container') ? [] : answers(NOW - 40)(name),
    )
    expect((await machineDetail(ch, 'vps', machineWindow('24h', NOW)))?.containers).toEqual([])
  })

  it('marks a silent stretch inside the range and the open one when silent now', async () => {
    const ch = fakeClickHouse((name) =>
      name === 'machines.detail.series'
        ? [
            { host: 'mini', t: NOW - 3600, idle: 0.9, mem_used: 0.5, load1: 1 },
            { host: 'mini', t: NOW - 3300, idle: 0.9, mem_used: 0.5, load1: 1 },
            { host: 'mini', t: NOW - 900, idle: 0.9, mem_used: 0.5, load1: 1 },
          ]
        : answers(NOW - 900)(name),
    )
    const d = await machineDetail(ch, 'mini', machineWindow('24h', NOW))
    expect(d?.state).toBe('silent')
    expect(d?.gaps).toEqual([
      { from: NOW - 3000, to: NOW - 900 },
      { from: NOW - 900, to: NOW },
    ])
  })
})
