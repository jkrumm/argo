import { format as formatDate } from 'date-fns'
import { ACCOUNT_IDS } from './accounts'
import type { Range } from '../../lib/queries/usage'

/** The shared time cursor of the time-axis charts. */
export const USAGE_TIME_GROUP = 'usage-time'

const RANGE_HOURS: Record<Range, number> = { '7d': 168, '30d': 720, '90d': 2160, all: 8760 }

export const rangeHours = (range: Range): number => RANGE_HOURS[range]

/** Registry accounts first, in registry order, then any other id the API sent, alphabetically. */
export function orderAccounts(ids: Iterable<string>): string[] {
  const seen = new Set(ids)
  const known = ACCOUNT_IDS.filter((id) => seen.has(id))
  const rest = [...seen].filter((id) => !ACCOUNT_IDS.some((k) => k === id)).toSorted()
  return [...known, ...rest]
}

export type PicksResponse = {
  total: number
  bucketHours: number
  counts: ReadonlyArray<{ lane: string; picked: string; reason: string; count: number }>
  pickedKeys: readonly string[]
  series: ReadonlyArray<{ at: string; picks: Record<string, number> }>
}

/** The picker's "no Max account had headroom" value: the caller spills to its IU path. */
export const SPILL = 'spill'

/** Under this many picks the lane split is noise. */
export const MIN_PICKS = 20
export const NOT_ENOUGH_PICKS = 'Not enough picks yet'

/** `since 24 Oct · 89 picks`: where the history starts and how much of it there is; `null` without picks. */
export function coverageLine(data: Pick<PicksResponse, 'total' | 'series'>): string | null {
  const first = data.series.reduce<number | null>((min, b) => {
    const at = Date.parse(b.at)
    return min === null || at < min ? at : min
  }, null)
  if (first === null || data.total === 0) return null
  return `since ${formatDate(first, 'd MMM')} · ${data.total} ${data.total === 1 ? 'pick' : 'picks'}`
}

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
