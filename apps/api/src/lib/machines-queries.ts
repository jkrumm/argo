import type { ChParams, ClickHouse } from '../clients/clickhouse.js'

/**
 * The Machines page's read model: host and container metrics of every machine in ClickStack (service
 * `host-agent`, OpenTelemetry host metrics `system.*`; containers from `docker_stats`, `container.*`).
 * Every function here is one named, parameterised query: the SQL is a constant in this file, the only
 * inputs are typed placeholders (`{from:UInt32}`) filled server-side by ClickHouse, every query filters on
 * the table's time column (the sort key, so partitions prune) and ends in a LIMIT. A request chooses a
 * `range` from a closed set and, for the detail, a host name that is only ever a placeholder value.
 */

export const MACHINE_RANGES = ['1h', '24h', '7d', '30d'] as const
export type MachineRange = (typeof MACHINE_RANGES)[number]

/** Bucket width per range, sized so no series passes 400 points. UTC-aligned. */
const RANGE_SPEC: Record<MachineRange, { seconds: number; step: number }> = {
  '1h': { seconds: 3_600, step: 60 },
  '24h': { seconds: 86_400, step: 300 },
  '7d': { seconds: 7 * 86_400, step: 1_800 },
  '30d': { seconds: 30 * 86_400, step: 7_200 },
}

export type RangeWindow = { range: MachineRange; from: number; to: number; step: number }

/** `from` snaps down to a bucket edge so the first bucket is whole; `to` is now. Unix seconds. */
export function machineWindow(range: MachineRange, nowSec: number): RangeWindow {
  const { seconds, step } = RANGE_SPEC[range]
  return { range, from: Math.floor((nowSec - seconds) / step) * step, to: nowSec, step }
}

/** No sample for this long and a machine is silent: unknown, never zero. */
export const SILENT_AFTER_S = 600
/** A machine is listed while it reported within this long. */
const LISTED_FOR_S = 86_400
/** The detail's containers are the means of this many seconds. */
const CONTAINER_WINDOW_S = 300
const TOP_CONTAINERS = 6

/** Containers come from the host agent and, until it takes over, from the older `host-probe` service. */
const CONTAINER_SERVICES = `ServiceName IN ('host-agent', 'host-probe')`

const AGENT_SCOPE = `ServiceName = 'host-agent'
  AND ResourceAttributes['deployment.environment.name'] = 'prod'
  AND TimeUnix >= fromUnixTimestamp({from:UInt32})
  AND TimeUnix < fromUnixTimestamp({to:UInt32})`

/** An empty `host` means every machine; a name narrows to that one (a placeholder, never SQL text). */
const HOST_FILTER = `AND ({host:String} = '' OR ResourceAttributes['host.name'] = {host:String})`

/** Tunnels, loopback, bridges and virtual interfaces would count the same bytes twice. */
const VIRTUAL_DEVICE = `^(lo|tailscale|utun|veth|docker|br-|bridge|awdl|llw|gif|stf|ap[0-9]|anpi)`

const num = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null
const round = (v: number | null, digits: number): number | null =>
  v === null ? null : Number(v.toFixed(digits))

// ── Which machines reported, and when ───────────────────────────────────────────────────────

const LAST_SEEN_SQL = `
SELECT ResourceAttributes['host.name'] AS host, toUnixTimestamp(max(TimeUnix)) AS last_seen
FROM default.otel_metrics_gauge
WHERE ${AGENT_SCOPE}
  AND MetricName = 'system.cpu.utilization'
GROUP BY host
ORDER BY host
LIMIT 100
FORMAT JSON`

type LastSeenRow = { host: string; last_seen: number }

// ── Series per bucket (CPU, memory, load) ───────────────────────────────────────────────────

const SERIES_SQL = `
SELECT ResourceAttributes['host.name'] AS host,
  toUnixTimestamp(toStartOfInterval(TimeUnix, INTERVAL {step:UInt32} SECOND)) AS t,
  avgIf(Value, MetricName = 'system.cpu.utilization' AND Attributes['state'] = 'idle') AS idle,
  avgIf(Value, MetricName = 'system.memory.utilization' AND Attributes['state'] = 'used') AS mem_used,
  avgIf(Value, MetricName = 'system.cpu.load_average.1m') AS load1
FROM default.otel_metrics_gauge
WHERE ${AGENT_SCOPE}
  ${HOST_FILTER}
  AND MetricName IN ('system.cpu.utilization', 'system.memory.utilization', 'system.cpu.load_average.1m')
GROUP BY host, t
ORDER BY host, t
LIMIT 8000
FORMAT JSON`

type SeriesRow = {
  host: string
  t: number
  idle: number | null
  mem_used: number | null
  load1: number | null
}

// ── The newest sample of each host: the "now" column values (a mean over cores per timestamp) ─

const NOW_SQL = `
SELECT host,
  argMaxIf(idle, ts, NOT isNaN(idle)) AS idle,
  argMaxIf(mem_used, ts, NOT isNaN(mem_used)) AS mem_used,
  argMaxIf(load1, ts, NOT isNaN(load1)) AS load1
FROM (
  SELECT ResourceAttributes['host.name'] AS host, TimeUnix AS ts,
    avgIf(Value, MetricName = 'system.cpu.utilization' AND Attributes['state'] = 'idle') AS idle,
    avgIf(Value, MetricName = 'system.memory.utilization' AND Attributes['state'] = 'used') AS mem_used,
    avgIf(Value, MetricName = 'system.cpu.load_average.1m') AS load1
  FROM default.otel_metrics_gauge
  WHERE ${AGENT_SCOPE}
    ${HOST_FILTER}
    AND MetricName IN ('system.cpu.utilization', 'system.memory.utilization', 'system.cpu.load_average.1m')
  GROUP BY host, ts
)
GROUP BY host
LIMIT 100
FORMAT JSON`

type NowRow = {
  host: string
  idle: number | null
  mem_used: number | null
  load1: number | null
}

const CORES_SQL = `
SELECT ResourceAttributes['host.name'] AS host, argMax(Value, TimeUnix) AS cores
FROM default.otel_metrics_sum
WHERE ${AGENT_SCOPE}
  ${HOST_FILTER}
  AND MetricName = 'system.cpu.logical.count'
GROUP BY host
LIMIT 100
FORMAT JSON`

type CoresRow = { host: string; cores: number }

// ── Filesystems ─────────────────────────────────────────────────────────────────────────────

const FILESYSTEM_SQL = `
SELECT ResourceAttributes['host.name'] AS host, Attributes['mountpoint'] AS mount,
  Attributes['type'] AS fs_type, argMax(Value, TimeUnix) AS used
FROM default.otel_metrics_gauge
WHERE ${AGENT_SCOPE}
  ${HOST_FILTER}
  AND MetricName = 'system.filesystem.utilization'
  AND Attributes['type'] NOT IN ('squashfs', 'tmpfs', 'devtmpfs', 'overlay', 'iso9660')
GROUP BY host, mount, fs_type
ORDER BY host, used DESC
LIMIT 500
FORMAT JSON`

type FilesystemRow = { host: string; mount: string; fs_type: string; used: number }

// ── Cumulative counters (network, disk IO): the newest value per bucket and series ───────────

const NETWORK_SQL = `
SELECT ResourceAttributes['host.name'] AS host,
  toUnixTimestamp(toStartOfInterval(TimeUnix, INTERVAL {step:UInt32} SECOND)) AS t,
  Attributes['device'] AS device, Attributes['direction'] AS direction, max(Value) AS total,
  toUnixTimestamp(max(TimeUnix)) AS at
FROM default.otel_metrics_sum
WHERE ${AGENT_SCOPE}
  ${HOST_FILTER}
  AND MetricName = 'system.network.io'
  AND NOT match(Attributes['device'], '${VIRTUAL_DEVICE}')
GROUP BY host, t, device, direction
ORDER BY host, device, direction, t
LIMIT 60000
FORMAT JSON`

const DISK_IO_SQL = `
SELECT ResourceAttributes['host.name'] AS host,
  toUnixTimestamp(toStartOfInterval(TimeUnix, INTERVAL {step:UInt32} SECOND)) AS t,
  Attributes['device'] AS device, Attributes['direction'] AS direction, max(Value) AS total,
  toUnixTimestamp(max(TimeUnix)) AS at
FROM default.otel_metrics_sum
WHERE ${AGENT_SCOPE}
  ${HOST_FILTER}
  AND MetricName = 'system.disk.io'
GROUP BY host, t, device, direction
ORDER BY host, device, direction, t
LIMIT 60000
FORMAT JSON`

/** `t` is the bucket start, `at` the newest sample in it: a rate divides by the time between samples, so the bucket still filling is exact. */
type CounterRow = {
  host: string
  t: number
  at: number
  device: string
  direction: string
  total: number
}

// ── Containers ──────────────────────────────────────────────────────────────────────────────

const CONTAINER_CPU_SQL = `
SELECT ResourceAttributes['container.name'] AS name, avg(Value) AS cpu
FROM default.otel_metrics_gauge
WHERE ${CONTAINER_SERVICES}
  AND ResourceAttributes['deployment.environment.name'] = 'prod'
  AND ResourceAttributes['host.name'] = {host:String}
  AND TimeUnix >= fromUnixTimestamp({from:UInt32})
  AND TimeUnix < fromUnixTimestamp({to:UInt32})
  AND MetricName = 'container.cpu.utilization'
GROUP BY name
LIMIT 500
FORMAT JSON`

const CONTAINER_MEMORY_SQL = `
SELECT ResourceAttributes['container.name'] AS name, avg(Value) AS memory
FROM default.otel_metrics_sum
WHERE ${CONTAINER_SERVICES}
  AND ResourceAttributes['deployment.environment.name'] = 'prod'
  AND ResourceAttributes['host.name'] = {host:String}
  AND TimeUnix >= fromUnixTimestamp({from:UInt32})
  AND TimeUnix < fromUnixTimestamp({to:UInt32})
  AND MetricName = 'container.memory.usage.total'
GROUP BY name
LIMIT 500
FORMAT JSON`

type ContainerCpuRow = { name: string; cpu: number }
type ContainerMemoryRow = { name: string; memory: number }

// ── Counter rates ───────────────────────────────────────────────────────────────────────────

export type RatePoint = { t: number; inBps: number | null; outBps: number | null }

/**
 * Per-second rates from a cumulative counter, summed over devices. A series' rate in a bucket is the
 * rise since its previous bucket over the time between the two buckets' newest samples (exact for the
 * bucket still filling). A counter reset (the value fell) and a hole of
 * more than one empty bucket are gaps, never a spike; the first bucket of a series has no rate. A
 * bucket with no rate in any series is absent. `in`: receive/read, `out`: transmit/write.
 */
export function counterRates(
  rows: CounterRow[],
  step: number,
  directions: { in: string; out: string },
): Map<string, Map<number, RatePoint>> {
  const bySeries = new Map<string, CounterRow[]>()
  for (const row of rows) {
    const key = `${row.host}\u0000${row.device}\u0000${row.direction}`
    const list = bySeries.get(key)
    if (list) list.push(row)
    else bySeries.set(key, [row])
  }
  const out = new Map<string, Map<number, RatePoint>>()
  for (const list of bySeries.values()) {
    list.sort((a, b) => a.t - b.t)
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]
      const cur = list[i]
      if (!prev || !cur) continue
      const elapsed = cur.at - prev.at
      const rise = cur.total - prev.total
      if (cur.t - prev.t > 2 * step || elapsed <= 0 || rise < 0) continue
      const isIn = cur.direction === directions.in
      if (!isIn && cur.direction !== directions.out) continue
      let perHost = out.get(cur.host)
      if (!perHost) {
        perHost = new Map()
        out.set(cur.host, perHost)
      }
      const point = perHost.get(cur.t) ?? { t: cur.t, inBps: null, outBps: null }
      const rate = rise / elapsed
      if (isIn) point.inBps = (point.inBps ?? 0) + rate
      else point.outBps = (point.outBps ?? 0) + rate
      perHost.set(cur.t, point)
    }
  }
  return out
}

// ── Silence and reporting ───────────────────────────────────────────────────────────────────

export type Gap = { from: number; to: number }

/**
 * Silent stretches of a machine in the window: between two buckets that hold samples, empty time of at
 * least SILENT_AFTER_S, plus an open stretch from the last sample to `to` when that is as long.
 */
export function silentGaps(
  bucketTimes: number[],
  step: number,
  lastSeen: number | null,
  to: number,
): Gap[] {
  const gaps: Gap[] = []
  for (let i = 1; i < bucketTimes.length; i++) {
    const prev = bucketTimes[i - 1]
    const cur = bucketTimes[i]
    if (prev === undefined || cur === undefined) continue
    if (cur - prev - step >= SILENT_AFTER_S) gaps.push({ from: prev + step, to: cur })
  }
  if (lastSeen !== null && to - lastSeen >= SILENT_AFTER_S) gaps.push({ from: lastSeen, to })
  return gaps
}

/** Share of buckets with a sample, from the machine's first bucket in the window to `to`. */
export function reportingPct(bucketTimes: number[], step: number, to: number): number | null {
  const first = bucketTimes[0]
  if (first === undefined) return null
  const expected = Math.max(1, Math.ceil((to - first) / step))
  return round(Math.min(100, (100 * bucketTimes.length) / expected), 1)
}

// ── Public read functions ───────────────────────────────────────────────────────────────────

export type MachinePoint = {
  t: number
  cpuPct: number | null
  memPct: number | null
  netInBps: number | null
  netOutBps: number | null
}

export type Machine = {
  host: string
  /** `silent`: no sample for SILENT_AFTER_S. The current values are then null, never zero. */
  state: 'reporting' | 'silent'
  lastSeen: number
  /** Share of buckets with a sample over the range, since the machine's first bucket in it. */
  reportingPct: number | null
  cores: number | null
  cpuPct: number | null
  memPct: number | null
  load1: number | null
  fullestFilesystem: { mount: string; pct: number } | null
  netInBps: number | null
  netOutBps: number | null
  points: MachinePoint[]
}

export type MachinesOverview = RangeWindow & { machines: Machine[] }

const pctOfIdle = (idle: number | null | undefined): number | null =>
  num(idle) === null ? null : round(100 * (1 - (idle as number)), 1)
const pctOf = (fraction: number | null | undefined): number | null =>
  num(fraction) === null ? null : round(100 * (fraction as number), 1)

function windowParams(w: RangeWindow, host = ''): ChParams {
  return { from: w.from, to: w.to, step: w.step, host }
}

/** The newest-sample window for the "now" values: the silence threshold, up to `to`. */
function recentParams(nowSec: number, host = ''): ChParams {
  return { from: nowSec - SILENT_AFTER_S, to: nowSec + 60, step: 60, host }
}

async function lastSeenByHost(ch: ClickHouse, nowSec: number): Promise<Map<string, number>> {
  const rows = await ch.query<LastSeenRow>('machines.last_seen', LAST_SEEN_SQL, {
    from: nowSec - LISTED_FOR_S,
    to: nowSec + 60,
  })
  return new Map(rows.filter((r) => r.host !== '').map((r) => [r.host, r.last_seen]))
}

/** Every machine that reported in the last 24 h: its newest values and a series over the range. */
export async function machinesOverview(
  ch: ClickHouse,
  window: RangeWindow,
): Promise<MachinesOverview> {
  const nowSec = window.to
  const [lastSeen, series, current, cores, filesystems, network] = await Promise.all([
    lastSeenByHost(ch, nowSec),
    ch.query<SeriesRow>('machines.series', SERIES_SQL, windowParams(window)),
    ch.query<NowRow>('machines.now', NOW_SQL, recentParams(nowSec)),
    ch.query<CoresRow>('machines.cores', CORES_SQL, recentParams(nowSec)),
    ch.query<FilesystemRow>('machines.filesystems', FILESYSTEM_SQL, recentParams(nowSec)),
    ch.query<CounterRow>('machines.network', NETWORK_SQL, {
      ...windowParams(window),
      from: window.from - window.step,
    }),
  ])
  const rates = counterRates(network, window.step, { in: 'receive', out: 'transmit' })

  const machines: Machine[] = [...lastSeen.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([host, seen]) => {
      const rows = series.filter((r) => r.host === host)
      const hostRates = rates.get(host)
      const silent = nowSec - seen >= SILENT_AFTER_S
      const now = silent ? undefined : current.find((r) => r.host === host)
      const fullest = silent ? undefined : filesystems.find((r) => r.host === host)
      const newestRate = silent
        ? undefined
        : [...(hostRates?.values() ?? [])].toSorted((a, b) => b.t - a.t)[0]
      return {
        host,
        state: silent ? 'silent' : 'reporting',
        lastSeen: seen,
        reportingPct: reportingPct(
          rows.map((r) => r.t),
          window.step,
          window.to,
        ),
        cores: silent ? null : (num(cores.find((r) => r.host === host)?.cores) ?? null),
        cpuPct: pctOfIdle(now?.idle),
        memPct: pctOf(now?.mem_used),
        load1: round(num(now?.load1), 2),
        fullestFilesystem: fullest ? { mount: fullest.mount, pct: pctOf(fullest.used) ?? 0 } : null,
        netInBps: round(newestRate?.inBps ?? null, 0),
        netOutBps: round(newestRate?.outBps ?? null, 0),
        points: rows.map((r) => {
          const rate = hostRates?.get(r.t)
          return {
            t: r.t,
            cpuPct: pctOfIdle(r.idle),
            memPct: pctOf(r.mem_used),
            netInBps: round(rate?.inBps ?? null, 0),
            netOutBps: round(rate?.outBps ?? null, 0),
          }
        }),
      } satisfies Machine
    })
  return { ...window, machines }
}

export type DetailPoint = MachinePoint & {
  diskReadBps: number | null
  diskWriteBps: number | null
}

export type MachineDetail = RangeWindow & {
  host: string
  state: 'reporting' | 'silent'
  lastSeen: number
  points: DetailPoint[]
  /** Silent stretches of at least 10 minutes, for shading on every chart's shared axis. */
  gaps: Gap[]
  /** Fill per mount now, fullest first. */
  filesystems: { mount: string; type: string; pct: number }[]
  /** Top containers by CPU over the last 5 minutes; empty on a machine without Docker. */
  containers: { name: string; cpuPct: number; memBytes: number | null }[]
}

/** One machine's series, filesystems and containers; null when it has not reported in 24 h. */
export async function machineDetail(
  ch: ClickHouse,
  host: string,
  window: RangeWindow,
): Promise<MachineDetail | null> {
  const nowSec = window.to
  const params = windowParams(window, host)
  const [lastSeen, series, filesystems, network, disk, cpu, memory] = await Promise.all([
    lastSeenByHost(ch, nowSec),
    ch.query<SeriesRow>('machines.detail.series', SERIES_SQL, params),
    ch.query<FilesystemRow>(
      'machines.detail.filesystems',
      FILESYSTEM_SQL,
      recentParams(nowSec, host),
    ),
    ch.query<CounterRow>('machines.detail.network', NETWORK_SQL, {
      ...params,
      from: window.from - window.step,
    }),
    ch.query<CounterRow>('machines.detail.disk', DISK_IO_SQL, {
      ...params,
      from: window.from - window.step,
    }),
    ch.query<ContainerCpuRow>('machines.detail.container_cpu', CONTAINER_CPU_SQL, {
      host,
      from: nowSec - CONTAINER_WINDOW_S,
      to: nowSec + 60,
    }),
    ch.query<ContainerMemoryRow>('machines.detail.container_memory', CONTAINER_MEMORY_SQL, {
      host,
      from: nowSec - CONTAINER_WINDOW_S,
      to: nowSec + 60,
    }),
  ])
  const seen = lastSeen.get(host)
  if (seen === undefined) return null

  const net = counterRates(network, window.step, { in: 'receive', out: 'transmit' }).get(host)
  const io = counterRates(disk, window.step, { in: 'read', out: 'write' }).get(host)
  const times = series.map((r) => r.t)
  const silent = nowSec - seen >= SILENT_AFTER_S
  const memoryByName = new Map(memory.map((r) => [r.name, r.memory]))

  return {
    ...window,
    host,
    state: silent ? 'silent' : 'reporting',
    lastSeen: seen,
    points: series.map((r) => ({
      t: r.t,
      cpuPct: pctOfIdle(r.idle),
      memPct: pctOf(r.mem_used),
      netInBps: round(net?.get(r.t)?.inBps ?? null, 0),
      netOutBps: round(net?.get(r.t)?.outBps ?? null, 0),
      diskReadBps: round(io?.get(r.t)?.inBps ?? null, 0),
      diskWriteBps: round(io?.get(r.t)?.outBps ?? null, 0),
    })),
    gaps: silentGaps(times, window.step, seen, window.to),
    filesystems: filesystems
      .filter((r) => r.host === host)
      .map((r) => ({ mount: r.mount, type: r.fs_type, pct: pctOf(r.used) ?? 0 })),
    containers: cpu
      .filter((r) => r.name !== '' && num(r.cpu) !== null)
      .toSorted((a, b) => b.cpu - a.cpu || a.name.localeCompare(b.name))
      .slice(0, TOP_CONTAINERS)
      .map((r) => ({
        name: r.name,
        cpuPct: round(r.cpu, 2) ?? 0,
        memBytes: round(num(memoryByName.get(r.name)), 0),
      })),
  }
}

/** Every query in this module, for the tests that pin the contract (time filter and LIMIT on each). */
export const MACHINES_SQL = {
  LAST_SEEN_SQL,
  SERIES_SQL,
  NOW_SQL,
  CORES_SQL,
  FILESYSTEM_SQL,
  NETWORK_SQL,
  DISK_IO_SQL,
  CONTAINER_CPU_SQL,
  CONTAINER_MEMORY_SQL,
} as const
