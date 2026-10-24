import { startOfDay } from 'date-fns'
import { ACCOUNT_IDS } from './accounts'
import type { Range } from '../../lib/queries/usage'

/** The shared time cursor of the Claude-accounts charts and the cost chart above them. */
export const USAGE_TIME_GROUP = 'usage-time'

/** The picker's eligibility limits (docs/claude-accounts.md Rule v1): session < 85 %, weekly < 90 %. */
export const FIVE_HOUR_LIMIT = 85
export const SEVEN_DAY_LIMIT = 90

/** Reset markers on the 5 h lines only while the window is short enough to tell them apart (~5 a day). */
export const FIVE_HOUR_MARKER_MAX_HOURS = 72

const RANGE_HOURS: Record<Range, number> = { '7d': 168, '30d': 720, '90d': 2160, all: 8760 }

export const rangeHours = (range: Range): number => RANGE_HOURS[range]

/** The plot's x domain, matching the cost chart's first day; `all` lets the data decide. */
export function rangeDomain(range: Range, now: number): readonly [Date, Date] | undefined {
  if (range === 'all') return undefined
  return [startOfDay(new Date(now - RANGE_HOURS[range] * 3_600_000)), new Date(now)]
}

export type QuotaWindow = 'five' | 'seven'

export type QuotaResponse = {
  series: ReadonlyArray<{
    account: string
    points: ReadonlyArray<{ at: string; fiveHourPct: number | null; sevenDayPct: number | null }>
  }>
  resets: ReadonlyArray<{ account: string; window: 'five_hour' | 'seven_day'; at: string }>
}

export type QuotaRow = {
  date: Date
  /** Keyed by `quotaKey`; absent or null = no sample for that account at this instant. */
  values: Record<string, number | null>
  /** `quotaKey`s whose window reset inside this bucket. */
  resets: ReadonlySet<string>
}

export const quotaKey = (account: string, window: QuotaWindow) => `${account}:${window}`

/** Registry accounts first, in registry order, then any other id the API sent, alphabetically. */
export function orderAccounts(ids: Iterable<string>): string[] {
  const seen = new Set(ids)
  const known = ACCOUNT_IDS.filter((id) => seen.has(id))
  const rest = [...seen].filter((id) => !ACCOUNT_IDS.some((k) => k === id)).toSorted()
  return [...known, ...rest]
}

/** Both accounts' series merged onto one row per bucket instant, so one chart draws all four lines. */
export function quotaRows(data: QuotaResponse): { accounts: string[]; rows: QuotaRow[] } {
  const accounts = orderAccounts(data.series.map((s) => s.account))
  const byTime = new Map<number, { values: Record<string, number | null>; resets: Set<string> }>()
  const slot = (ms: number) => {
    const row = byTime.get(ms) ?? { values: {}, resets: new Set<string>() }
    byTime.set(ms, row)
    return row
  }
  for (const s of data.series) {
    for (const p of s.points) {
      const row = slot(Date.parse(p.at))
      row.values[quotaKey(s.account, 'five')] = p.fiveHourPct
      row.values[quotaKey(s.account, 'seven')] = p.sevenDayPct
    }
  }
  for (const r of data.resets) {
    const ms = Date.parse(r.at)
    // A reset marks the line only where a sample exists at that instant: it sits on the drawn value.
    const row = byTime.get(ms)
    row?.resets.add(quotaKey(r.account, r.window === 'five_hour' ? 'five' : 'seven'))
  }
  const rows = [...byTime]
    .toSorted(([a], [b]) => a - b)
    .map(([ms, r]): QuotaRow => ({ date: new Date(ms), values: r.values, resets: r.resets }))
  return { accounts, rows }
}

export type PicksResponse = {
  total: number
  bucketHours: number
  counts: ReadonlyArray<{ lane: string; picked: string; reason: string; count: number }>
  pickedKeys: readonly string[]
  series: ReadonlyArray<{ at: string; picks: Record<string, number> }>
}

export type PickRow = { date: Date; picks: Record<string, number> }

export const pickRows = (data: PicksResponse): PickRow[] =>
  data.series.map((b) => ({ date: new Date(b.at), picks: b.picks }))

/** The picker's "no Max account had headroom" value: the caller spills to its IU path. */
export const SPILL = 'spill'

/** Account ids in registry order, `spill` (the non-Max fallback) last. */
export function orderPicked(keys: Iterable<string>): string[] {
  const all = [...keys]
  const accounts = orderAccounts(all.filter((k) => k !== SPILL))
  return all.includes(SPILL) ? [...accounts, SPILL] : accounts
}

export type LaneRow = {
  lane: string
  total: number
  byPicked: Record<string, number>
  reasons: Array<{ reason: string; count: number }>
}

/** One row per lane, busiest first: picks per account and the reasons behind them. */
export function laneRows(counts: PicksResponse['counts']): LaneRow[] {
  const lanes = new Map<string, LaneRow>()
  for (const c of counts) {
    const row = lanes.get(c.lane) ?? { lane: c.lane, total: 0, byPicked: {}, reasons: [] }
    lanes.set(c.lane, row)
    row.total += c.count
    row.byPicked[c.picked] = (row.byPicked[c.picked] ?? 0) + c.count
    const reason = row.reasons.find((r) => r.reason === c.reason)
    if (reason) reason.count += c.count
    else row.reasons.push({ reason: c.reason, count: c.count })
  }
  return [...lanes.values()]
    .map((r) => ({ ...r, reasons: r.reasons.toSorted((a, b) => b.count - a.count) }))
    .toSorted((a, b) => b.total - a.total || a.lane.localeCompare(b.lane))
}
