import type { ChParams, ClickHouse } from '../clients/clickhouse.js'

/**
 * The Line page's read model: linewatch's history in ClickStack (service `linewatch-app`, metrics `line.*`,
 * log events `line.outage.*`; contract: linewatch docs/DESIGN.md §Export and retention). Every function
 * here is one named, parameterised query: the SQL is a constant in this file, the only inputs are typed
 * placeholders (`{from:UInt32}`) filled server-side by ClickHouse, every query filters on the table's time
 * column (the sort key, so partitions prune) and ends in a LIMIT. A request chooses a `window` from a closed
 * set; it never contributes SQL, a table name or a metric name.
 */

export const LINE_WINDOWS = ['24h', '7d', '30d', '90d'] as const
export type LineWindow = (typeof LINE_WINDOWS)[number]

/** Bucket width per window. UTC-aligned; 90 d is whole UTC days so a chart bar is one day of the table. */
const WINDOW_SPEC: Record<LineWindow, { seconds: number; step: number }> = {
  '24h': { seconds: 86_400, step: 300 },
  '7d': { seconds: 7 * 86_400, step: 3_600 },
  '30d': { seconds: 30 * 86_400, step: 21_600 },
  '90d': { seconds: 90 * 86_400, step: 86_400 },
}

export type WindowRange = { window: LineWindow; from: number; to: number; step: number }

/** `from` snaps down to a bucket edge so the first bucket is whole; `to` is now. Unix seconds. */
export function windowRange(window: LineWindow, nowSec: number): WindowRange {
  const { seconds, step } = WINDOW_SPEC[window]
  return { window, from: Math.floor((nowSec - seconds) / step) * step, to: nowSec, step }
}

/** The probe targets in display order; the gateway is the router, the rest are internet anchors. */
export const PROBE_TARGETS = ['gateway', 'cloudflare', 'google', 'quad9'] as const

/** Metrics keep 400 days; the outage gauge is the one series read that far back. */
const OUTAGE_LOOKBACK_S = 400 * 86_400
/** A probe sample older than this means the collector or the export stalled: "unknown", never "up". */
export const STALE_AFTER_S = 180
const TWO_DAYS_S = 2 * 86_400

const METRIC_SCOPE = `ServiceName = 'linewatch-app'
  AND ResourceAttributes['deployment.environment.name'] = 'prod'
  AND TimeUnix >= fromUnixTimestamp({from:UInt32})
  AND TimeUnix < fromUnixTimestamp({to:UInt32})`

const num = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null
const round = (v: number | null, digits: number): number | null =>
  v === null ? null : Number(v.toFixed(digits))
const lossPct = (sent: number, received: number): number | null =>
  sent > 0 ? Math.max(0, round(100 * (1 - received / sent), 3) ?? 0) : null

// ── Latency and loss per target ─────────────────────────────────────────────────────────────

const LATENCY_SQL = `
SELECT toUnixTimestamp(toStartOfInterval(TimeUnix, INTERVAL {step:UInt32} SECOND)) AS t,
  Attributes['target'] AS target,
  sumIf(Value, MetricName = 'line.probe.sent') AS sent,
  sumIf(Value, MetricName = 'line.probe.received') AS received,
  quantileIf(0.5)(Value, MetricName = 'line.probe.rtt.median') AS rtt_median
FROM default.otel_metrics_gauge
WHERE ${METRIC_SCOPE}
  AND MetricName IN ('line.probe.sent', 'line.probe.received', 'line.probe.rtt.median')
GROUP BY t, target
ORDER BY t, target
LIMIT 5000
FORMAT JSON`

const LATENCY_TOTALS_SQL = `
SELECT Attributes['target'] AS target,
  sumIf(Value, MetricName = 'line.probe.sent') AS sent,
  sumIf(Value, MetricName = 'line.probe.received') AS received,
  quantileIf(0.5)(Value, MetricName = 'line.probe.rtt.median') AS rtt_median
FROM default.otel_metrics_gauge
WHERE ${METRIC_SCOPE}
  AND MetricName IN ('line.probe.sent', 'line.probe.received', 'line.probe.rtt.median')
GROUP BY target
ORDER BY target
LIMIT 20
FORMAT JSON`

type LatencyRow = {
  t: number
  target: string
  sent: number
  received: number
  rtt_median: number | null
}
type LatencyTotalRow = Omit<LatencyRow, 't'>

export type LatencyPoint = { t: number; lossPct: number | null; rttMs: number | null }
export type TargetLatency = {
  target: string
  scope: 'gateway' | 'wan'
  /** Loss over the whole window: 100 x (1 - received / sent) over every 30 s probe cycle. */
  lossPct: number | null
  /** Median over the window of the per-cycle median round-trip time. */
  rttMs: number | null
  points: LatencyPoint[]
}
export type LatencyResult = WindowRange & { targets: TargetLatency[] }

const targetOrder = (target: string): number => {
  const i = (PROBE_TARGETS as readonly string[]).indexOf(target)
  return i === -1 ? PROBE_TARGETS.length : i
}

export async function latencyByTarget(ch: ClickHouse, range: WindowRange): Promise<LatencyResult> {
  const params: ChParams = { from: range.from, to: range.to, step: range.step }
  const [rows, totals] = await Promise.all([
    ch.query<LatencyRow>('line.latency', LATENCY_SQL, params),
    ch.query<LatencyTotalRow>('line.latency.totals', LATENCY_TOTALS_SQL, params),
  ])
  const byTarget = new Map<string, TargetLatency>()
  const entry = (target: string): TargetLatency => {
    const existing = byTarget.get(target)
    if (existing) return existing
    const created: TargetLatency = {
      target,
      scope: target === 'gateway' ? 'gateway' : 'wan',
      lossPct: null,
      rttMs: null,
      points: [],
    }
    byTarget.set(target, created)
    return created
  }
  for (const total of totals) {
    const t = entry(total.target)
    t.lossPct = lossPct(total.sent, total.received)
    t.rttMs = round(num(total.rtt_median), 2)
  }
  for (const row of rows) {
    entry(row.target).points.push({
      t: row.t,
      lossPct: lossPct(row.sent, row.received),
      rttMs: round(num(row.rtt_median), 2),
    })
  }
  const targets = [...byTarget.values()].toSorted(
    (a, b) => targetOrder(a.target) - targetOrder(b.target) || a.target.localeCompare(b.target),
  )
  return { ...range, targets }
}

// ── Outages and uptime ──────────────────────────────────────────────────────────────────────

/** The close of an internet outage carries its length as a gauge (400 d), where the log event lives 30 d. */
const OUTAGES_SQL = `
SELECT toUnixTimestamp(TimeUnix) AS ended, max(Value) AS duration_s
FROM default.otel_metrics_gauge
WHERE ServiceName = 'linewatch-app'
  AND ResourceAttributes['deployment.environment.name'] = 'prod'
  AND MetricName = 'line.outage.duration'
  AND Attributes['scope'] = 'wan'
  AND TimeUnix >= fromUnixTimestamp({from:UInt32})
GROUP BY ended
ORDER BY ended DESC
LIMIT {limit:UInt32}
FORMAT JSON`

/** Per scope: the newest open and close event. Open and not yet closed = ongoing (the log lives 30 d; two days is plenty). */
const OPEN_OUTAGE_SQL = `
SELECT LogAttributes['scope'] AS scope,
  maxIf(toUnixTimestamp(Timestamp), Body = 'line.outage.opened') AS opened,
  maxIf(toUnixTimestamp(Timestamp), Body = 'line.outage.closed') AS closed
FROM default.otel_logs
WHERE ServiceName = 'linewatch-app'
  AND ResourceAttributes['deployment.environment.name'] = 'prod'
  AND TimestampTime >= fromUnixTimestamp({from:UInt32})
  AND Body IN ('line.outage.opened', 'line.outage.closed')
GROUP BY scope
LIMIT 10
FORMAT JSON`

type OutageRow = { ended: number; duration_s: number }
type OpenRow = { scope: string; opened: number; closed: number }

export type Outage = { start: number; end: number; durationS: number; ongoing: boolean }

/** Start of the open internet outage, or null. Never inferred from silence: only an `opened` without its `closed`. */
async function ongoingOutageStart(ch: ClickHouse, nowSec: number): Promise<number | null> {
  const rows = await ch.query<OpenRow>('line.outage.open', OPEN_OUTAGE_SQL, {
    from: nowSec - TWO_DAYS_S,
  })
  const wan = rows.find((r) => r.scope === 'wan')
  return wan && wan.opened > 0 && wan.opened > wan.closed ? wan.opened : null
}

export type UptimeResult = WindowRange & {
  /** Share of the window the internet scope was not in an outage, 0-100. */
  uptimePct: number
  downtimeS: number
  /** Newest first; an outage straddling the window start is clipped to it. */
  outages: Outage[]
}

export async function uptime(ch: ClickHouse, range: WindowRange): Promise<UptimeResult> {
  const [rows, ongoing] = await Promise.all([
    ch.query<OutageRow>('line.outages', OUTAGES_SQL, { from: range.from, limit: 500 }),
    ongoingOutageStart(ch, range.to),
  ])
  const outages: Outage[] = []
  for (const row of rows) {
    const start = Math.max(row.ended - row.duration_s, range.from)
    if (row.ended <= start) continue
    outages.push({ start, end: row.ended, durationS: row.ended - start, ongoing: false })
  }
  if (ongoing !== null) {
    const start = Math.max(ongoing, range.from)
    outages.unshift({
      start,
      end: range.to,
      durationS: Math.max(range.to - start, 0),
      ongoing: true,
    })
  }
  const downtimeS = outages.reduce((sum, o) => sum + o.durationS, 0)
  const span = range.to - range.from
  return {
    ...range,
    outages,
    downtimeS,
    uptimePct: span > 0 ? Math.max(0, round(100 * (1 - downtimeS / span), 3) ?? 0) : 100,
  }
}

// ── Router line (G.fast sync rate and noise margin) ─────────────────────────────────────────

const SYNC_SQL = `
SELECT toUnixTimestamp(toStartOfInterval(TimeUnix, INTERVAL {step:UInt32} SECOND)) AS t,
  avgIf(Value, MetricName = 'line.router.sync_rate' AND Attributes['direction'] = 'down') AS sync_down,
  avgIf(Value, MetricName = 'line.router.sync_rate' AND Attributes['direction'] = 'up') AS sync_up,
  avgIf(Value, MetricName = 'line.router.noise_margin' AND Attributes['direction'] = 'down') AS noise_down,
  avgIf(Value, MetricName = 'line.router.noise_margin' AND Attributes['direction'] = 'up') AS noise_up
FROM default.otel_metrics_gauge
WHERE ${METRIC_SCOPE}
  AND MetricName IN ('line.router.sync_rate', 'line.router.noise_margin')
GROUP BY t
ORDER BY t
LIMIT 2000
FORMAT JSON`

type SyncRow = {
  t: number
  sync_down: number | null
  sync_up: number | null
  noise_down: number | null
  noise_up: number | null
}
export type SyncPoint = {
  t: number
  syncDownMbit: number | null
  syncUpMbit: number | null
  noiseDownDb: number | null
  noiseUpDb: number | null
}
export type SyncResult = WindowRange & { points: SyncPoint[] }

/** The router reports kbit/s; the page speaks Mbit/s. */
const mbit = (kbit: number | null | undefined): number | null =>
  round(num(kbit) === null ? null : (kbit as number) / 1000, 1)

export async function routerLine(ch: ClickHouse, range: WindowRange): Promise<SyncResult> {
  const rows = await ch.query<SyncRow>('line.router', SYNC_SQL, {
    from: range.from,
    to: range.to,
    step: range.step,
  })
  return {
    ...range,
    points: rows.map((r) => ({
      t: r.t,
      syncDownMbit: mbit(r.sync_down),
      syncUpMbit: mbit(r.sync_up),
      noiseDownDb: round(num(r.noise_down), 1),
      noiseUpDb: round(num(r.noise_up), 1),
    })),
  }
}

// ── Speed tests ─────────────────────────────────────────────────────────────────────────────

/** A run writes all its gauges at one timestamp, so grouping on TimeUnix reassembles a run. Hourly: 90 d is ~2200. */
const SPEEDTESTS_SQL = `
SELECT toUnixTimestamp(TimeUnix) AS t,
  maxIf(Value, MetricName = 'line.speedtest.download') AS download,
  maxIf(Value, MetricName = 'line.speedtest.upload') AS upload,
  maxIf(Value, MetricName = 'line.speedtest.ping') AS ping
FROM default.otel_metrics_gauge
WHERE ${METRIC_SCOPE}
  AND MetricName IN ('line.speedtest.download', 'line.speedtest.upload', 'line.speedtest.ping')
GROUP BY TimeUnix, t
ORDER BY t
LIMIT 3000
FORMAT JSON`

type SpeedRow = { t: number; download: number | null; upload: number | null; ping: number | null }
export type SpeedRun = {
  t: number
  downloadMbit: number | null
  uploadMbit: number | null
  pingMs: number | null
}
export type SpeedResult = WindowRange & { runs: SpeedRun[] }

export async function speedTests(ch: ClickHouse, range: WindowRange): Promise<SpeedResult> {
  const rows = await ch.query<SpeedRow>('line.speedtests', SPEEDTESTS_SQL, {
    from: range.from,
    to: range.to,
  })
  return {
    ...range,
    runs: rows.map((r) => ({
      t: r.t,
      downloadMbit: round(num(r.download), 1),
      uploadMbit: round(num(r.upload), 1),
      pingMs: round(num(r.ping), 1),
    })),
  }
}

// ── Now ─────────────────────────────────────────────────────────────────────────────────────

const LATEST_PROBE_SQL = `
SELECT toUnixTimestamp(max(TimeUnix)) AS t
FROM default.otel_metrics_gauge
WHERE ${METRIC_SCOPE}
  AND MetricName = 'line.probe.sent'
LIMIT 1
FORMAT JSON`

const LATEST_ROUTER_SQL = `
SELECT MetricName AS metric, Attributes['direction'] AS direction,
  argMax(Value, TimeUnix) AS value, toUnixTimestamp(max(TimeUnix)) AS t
FROM default.otel_metrics_gauge
WHERE ${METRIC_SCOPE}
  AND MetricName IN ('line.router.sync_rate', 'line.router.noise_margin')
GROUP BY metric, direction
LIMIT 10
FORMAT JSON`

const LATEST_SPEED_SQL = `
SELECT MetricName AS metric, argMax(Value, TimeUnix) AS value, toUnixTimestamp(max(TimeUnix)) AS t
FROM default.otel_metrics_gauge
WHERE ${METRIC_SCOPE}
  AND MetricName IN ('line.speedtest.download', 'line.speedtest.upload', 'line.speedtest.ping')
GROUP BY metric
LIMIT 10
FORMAT JSON`

type LatestProbeRow = { t: number | null }
type LatestRouterRow = { metric: string; direction: string; value: number; t: number }
type LatestSpeedRow = { metric: string; value: number; t: number }

export type LineNow = {
  /** `down`: an exported outage is open. `stale`: no probe sample for STALE_AFTER_S, so the line's state is unknown. */
  state: 'up' | 'down' | 'stale'
  /** Unix seconds of the newest probe sample; null when none in the last two days. */
  probeAt: number | null
  ongoingSince: number | null
  lastOutage: { start: number; end: number; durationS: number } | null
  router: {
    at: number
    syncDownMbit: number | null
    syncUpMbit: number | null
    noiseDownDb: number | null
    noiseUpDb: number | null
  } | null
  speedTest: {
    at: number
    downloadMbit: number | null
    uploadMbit: number | null
    pingMs: number | null
  } | null
}

export async function lineNow(ch: ClickHouse, nowSec: number): Promise<LineNow> {
  const recent = { from: nowSec - TWO_DAYS_S, to: nowSec + 60 }
  const [probe, ongoing, outage, router, speed] = await Promise.all([
    ch.query<LatestProbeRow>('line.now.probe', LATEST_PROBE_SQL, recent),
    ongoingOutageStart(ch, nowSec),
    ch.query<OutageRow>('line.now.outage', OUTAGES_SQL, {
      from: nowSec - OUTAGE_LOOKBACK_S,
      limit: 1,
    }),
    ch.query<LatestRouterRow>('line.now.router', LATEST_ROUTER_SQL, recent),
    ch.query<LatestSpeedRow>('line.now.speedtest', LATEST_SPEED_SQL, {
      from: nowSec - 7 * 86_400,
      to: nowSec + 60,
    }),
  ])
  const probeAt = probe[0]?.t && probe[0].t > 0 ? probe[0].t : null
  const state =
    ongoing !== null
      ? 'down'
      : probeAt === null || nowSec - probeAt > STALE_AFTER_S
        ? 'stale'
        : 'up'
  const last = outage[0]
  const pick = (metric: string, direction: string): LatestRouterRow | undefined =>
    router.find((r) => r.metric === metric && r.direction === direction)
  const speedValue = (metric: string): number | null =>
    num(speed.find((r) => r.metric === metric)?.value)
  return {
    state,
    probeAt,
    ongoingSince: ongoing,
    lastOutage: last
      ? { start: last.ended - last.duration_s, end: last.ended, durationS: last.duration_s }
      : null,
    router: router.length
      ? {
          at: Math.max(...router.map((r) => r.t)),
          syncDownMbit: mbit(pick('line.router.sync_rate', 'down')?.value),
          syncUpMbit: mbit(pick('line.router.sync_rate', 'up')?.value),
          noiseDownDb: round(num(pick('line.router.noise_margin', 'down')?.value), 1),
          noiseUpDb: round(num(pick('line.router.noise_margin', 'up')?.value), 1),
        }
      : null,
    speedTest: speed.length
      ? {
          at: Math.max(...speed.map((r) => r.t)),
          downloadMbit: round(speedValue('line.speedtest.download'), 1),
          uploadMbit: round(speedValue('line.speedtest.upload'), 1),
          pingMs: round(speedValue('line.speedtest.ping'), 1),
        }
      : null,
  }
}

/** Every query in this module, for the tests that pin the contract (time filter and LIMIT on each). */
export const LINE_SQL = {
  LATENCY_SQL,
  LATENCY_TOTALS_SQL,
  OUTAGES_SQL,
  OPEN_OUTAGE_SQL,
  SYNC_SQL,
  SPEEDTESTS_SQL,
  LATEST_PROBE_SQL,
  LATEST_ROUTER_SQL,
  LATEST_SPEED_SQL,
} as const
