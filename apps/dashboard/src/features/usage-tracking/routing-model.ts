/**
 * The Routing section's figures: the picker's decisions (`/usage/account-picks`) laid out as one
 * band row per lane, the reason mix, the facts of the strip, the 5 h sawtooth rows with their reset
 * ticks, and the tuning table. The picker log starts 2026-10-24 and the quota samples with it, so
 * every window is cut to where the data begins instead of drawing an empty axis. No React, no
 * queries.
 */
import { format as formatDate } from 'date-fns'
import { VX } from 'basalt-ui/tokens'
import type {
  AccountPick,
  PicksSummaryResponse,
  QuotaResponse,
  RoutingWindow,
  RoutingWindowSummary,
} from '../../lib/queries/usage'
import { ROUTING_REASON } from '../../lib/series'
import type { UsageRoutingRange } from '../../lib/window-stores'
import { PAYER_LABELS, USAGE_ACCOUNTS, payerOfAccount } from './accounts'
import { colorForPayer } from './constants'

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

/** The hours of picker history each range reads (the picks endpoint caps at 504 = 21 d). */
export const ROUTING_HOURS: Record<UsageRoutingRange, number> = {
  '1d': 24,
  '3d': 72,
  '7d': 168,
  '14d': 336,
  '21d': 504,
}

/** Band width of the lane rows: about 100–170 cells across the range, whatever it is. */
export function binMsFor(hours: number): number {
  if (hours <= 24) return 15 * MINUTE_MS
  if (hours <= 72) return 30 * MINUTE_MS
  if (hours <= 168) return HOUR_MS
  if (hours <= 336) return 2 * HOUR_MS
  return 3 * HOUR_MS
}

/** Where the drawn window begins: the range, but never before the first pick (no empty axis). */
export function windowStart(
  picks: readonly Pick<AccountPick, 'ts'>[],
  now: number,
  hours: number,
): number {
  const first = picks.reduce((min, p) => Math.min(min, Date.parse(p.ts)), Infinity)
  return Math.max(now - hours * HOUR_MS, Number.isFinite(first) ? first : -Infinity)
}

/** The account title of an id: its payer's label, or the id itself outside the registry. */
export const accountTitle = (account: string): string => {
  const payer = payerOfAccount(account)
  return payer === 'unknown' ? account : PAYER_LABELS[payer]
}

/** The payer shade of an account id. */
export const accountColor = (account: string): string => colorForPayer(payerOfAccount(account))

/** Registry order first, then any other id alphabetically. */
export function sortAccounts(accounts: Iterable<string>): string[] {
  const ids: string[] = USAGE_ACCOUNTS.map((a) => a.id)
  const rank = (a: string) => {
    const i = ids.indexOf(a)
    return i === -1 ? ids.length : i
  }
  return [...new Set(accounts)].toSorted((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

// ---------------------------------------------------------------------------------------------
// Picks timeline
// ---------------------------------------------------------------------------------------------

/** `picked` of a decision no Max account could serve. */
export const SPILL_PICKED = 'spill'
/** Band states that are not an account. */
export const IDLE_STATE = 'idle'
export const NONE_STATE = 'none'
export const SPILLED_STATE = 'spilled'

/** No account had room: the pick is `spill` (or the reason says so). */
export const isUnserved = (p: Pick<AccountPick, 'picked' | 'reason'>): boolean =>
  p.picked === SPILL_PICKED || p.reason === 'no-eligible-account'

/** An account served it, but only as the overflow of the lane's own account. */
export const isOverflow = (p: Pick<AccountPick, 'picked' | 'reason'>): boolean =>
  p.reason === 'spill' && !isUnserved(p)

export type LaneCell = { at: Date; picks: readonly AccountPick[] }
export type Lane = { lane: string; total: number; cells: LaneCell[] }

/**
 * One row per lane, busiest first, each a run of `binMs` cells from `fromMs` to `toMs` holding the
 * picks that fell in it (oldest first). Lanes past `cap` are counted, not drawn.
 */
export function laneRows(
  picks: readonly AccountPick[],
  fromMs: number,
  toMs: number,
  binMs: number,
  cap: number,
): { lanes: Lane[]; hidden: number } {
  const start = Math.floor(fromMs / binMs) * binMs
  const count = Math.max(1, Math.ceil((toMs - start) / binMs))
  const byLane = new Map<string, AccountPick[]>()
  for (const p of picks) {
    const t = Date.parse(p.ts)
    if (!(t >= start && t <= toMs)) continue
    const lane = byLane.get(p.lane)
    if (lane === undefined) byLane.set(p.lane, [p])
    else lane.push(p)
  }
  const lanes = [...byLane]
    .toSorted(([a, as], [b, bs]) => bs.length - as.length || a.localeCompare(b))
    .map(([lane, laneProps]): Lane => {
      const cells: LaneCell[] = Array.from({ length: count }, (_, i) => ({
        at: new Date(start + i * binMs),
        picks: [],
      }))
      const bins = cells.map((): AccountPick[] => [])
      for (const p of laneProps.toSorted((a, b) => Date.parse(a.ts) - Date.parse(b.ts))) {
        const i = Math.min(count - 1, Math.floor((Date.parse(p.ts) - start) / binMs))
        bins[i]?.push(p)
      }
      return {
        lane,
        total: laneProps.length,
        cells: cells.map((c, i) => ({ ...c, picks: bins[i]! })),
      }
    })
  return { lanes: lanes.slice(0, cap), hidden: Math.max(0, lanes.length - cap) }
}

/**
 * What a cell says: nothing, no account could serve (it wins over everything: the signal that
 * matters), else the account of its last pick, marked when any pick in it only overflowed there.
 */
export function cellState(picks: readonly AccountPick[]): { state: string; overflow: boolean } {
  const last = picks.at(-1)
  if (last === undefined) return { state: IDLE_STATE, overflow: false }
  if (picks.some(isUnserved)) return { state: NONE_STATE, overflow: false }
  return { state: last.picked, overflow: picks.some(isOverflow) }
}

/** The accounts that served any pick, in registry order. */
export const servedAccounts = (picks: readonly AccountPick[]): string[] =>
  sortAccounts(picks.filter((p) => !isUnserved(p)).map((p) => p.picked))

/** `iu 0/94 · me 35/93 · me2 11/1`: per account the 5 h and the weekly percent the picker saw. */
export function snapshotText(snapshot: AccountPick['snapshot']): string {
  const pct = (v: number | null) => (v === null ? '–' : String(Math.round(v)))
  const accounts = sortAccounts(Object.keys(snapshot))
  if (accounts.length === 0) return '–'
  return accounts
    .map((a) => `${a} ${pct(snapshot[a]?.s ?? null)}/${pct(snapshot[a]?.w ?? null)}`)
    .join(' · ')
}

/** `home`, or `home ×3 · pace` for several picks in one cell. */
export function reasonSummary(picks: readonly AccountPick[]): string {
  const counts = new Map<string, number>()
  for (const p of picks) counts.set(p.reason, (counts.get(p.reason) ?? 0) + 1)
  return [...counts].map(([reason, n]) => (n === 1 ? reason : `${reason} ×${n}`)).join(' · ')
}

const hhmm = (d: Date): string => formatDate(d, 'HH:mm')

/**
 * x ticks of a lane row, as the epoch ms of the cells that hold local clock times 6 h apart for a
 * day, 12 h for 3 d, then a day, two, three: every one a cell start, because a band axis only
 * places its own x values.
 */
export function stripTicks(cells: readonly LaneCell[], hours: number): number[] {
  const first = cells[0]
  const last = cells.at(-1)
  if (first === undefined || last === undefined) return []
  const binMs = cells.length > 1 ? cells[1]!.at.getTime() - first.at.getTime() : HOUR_MS
  const startMs = first.at.getTime()
  const endMs = last.at.getTime() + binMs
  const stepHours = hours <= 24 ? 6 : hours <= 72 ? 12 : hours <= 168 ? 24 : hours <= 336 ? 48 : 72
  const days = Math.ceil((endMs - startMs) / (24 * HOUR_MS)) + 1
  const origin = new Date(startMs)
  const ticks = new Set<number>()
  for (let day = 0; day <= days; day++) {
    for (let h = 0; h < 24; h += stepHours < 24 ? stepHours : 24) {
      if (stepHours >= 24 && day % (stepHours / 24) !== 0) continue
      const t = new Date(
        origin.getFullYear(),
        origin.getMonth(),
        origin.getDate() + day,
        h,
      ).getTime()
      if (t < startMs || t >= endMs) continue
      ticks.add(first.at.getTime() + Math.floor((t - startMs) / binMs) * binMs)
    }
  }
  return [...ticks].toSorted((a, b) => a - b)
}

/** A tick label: the clock time, the day on a local midnight. */
export function stripTickLabel(ms: number, formatDay: (d: Date) => string): string {
  const d = new Date(ms)
  return d.getHours() === 0 && d.getMinutes() === 0 ? formatDay(d) : hhmm(d)
}

// ---------------------------------------------------------------------------------------------
// Reason mix
// ---------------------------------------------------------------------------------------------

const HEALTHY_REASONS = ['home', 'pace', 'session'] as const
const STATUS_REASONS = ['spill', 'no-eligible-account'] as const

/** Healthy reasons first (home, pace, session), then any other alphabetically, status reasons last. */
export function reasonKeys(keys: readonly string[]): string[] {
  const known: readonly string[] = [...HEALTHY_REASONS, ...STATUS_REASONS]
  return [
    ...HEALTHY_REASONS.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !known.includes(k)).toSorted(),
    ...STATUS_REASONS.filter((k) => keys.includes(k)),
  ]
}

/** Accent shades for the healthy reasons, status inks for the two failures, grey for the rest. */
export function reasonColor(key: string): string {
  if (key === 'home') return ROUTING_REASON.home
  if (key === 'pace') return ROUTING_REASON.pace
  if (key === 'session') return ROUTING_REASON.session
  if (key === 'spill') return VX.status.warn
  if (key === 'no-eligible-account') return VX.status.bad
  return ROUTING_REASON.other
}

const REASON_LABELS: Record<string, string> = {
  home: 'Home',
  pace: 'Pace',
  session: 'Session',
  spill: 'Spill',
  'no-eligible-account': 'No eligible account',
  'interactive-fallback': 'Interactive fallback',
}

/** A reason in words; an unseen one is humanised, never dropped. */
export function reasonLabel(key: string): string {
  const known = REASON_LABELS[key]
  if (known !== undefined) return known
  const spaced = key.replaceAll('-', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export type ReasonRow = { at: Date; counts: Readonly<Record<string, number>>; total: number }

/** The summary's buckets as rows, oldest first. */
export function reasonRows(series: PicksSummaryResponse['series']): ReasonRow[] {
  return series
    .map((b) => ({
      at: new Date(b.at),
      counts: b.picks,
      total: Object.values(b.picks).reduce((sum, n) => sum + n, 0),
    }))
    .toSorted((a, b) => a.at.getTime() - b.at.getTime())
}

export type LaneSpill = { lane: string; total: number; spills: number; rate: number }

/** Lanes by spill rate, worst first; ties by pick count. */
export function laneSpillRows(lanes: PicksSummaryResponse['lanes']): LaneSpill[] {
  return lanes
    .map((l) => ({ lane: l.lane, total: l.total, spills: l.spills, rate: l.spillRate }))
    .toSorted((a, b) => b.rate - a.rate || b.total - a.total || a.lane.localeCompare(b.lane))
}

// ---------------------------------------------------------------------------------------------
// Facts and tuning table
// ---------------------------------------------------------------------------------------------

export const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null
  const s = xs.toSorted((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

const present = (xs: readonly (number | null)[]): number[] =>
  xs.filter((x): x is number => x !== null)

/** Spills over picks of the whole range; `null` rate without a pick. */
export function spillFacts(lanes: PicksSummaryResponse['lanes'], total: number) {
  const spills = lanes.reduce((sum, l) => sum + l.spills, 0)
  return { picks: total, spills, rate: total === 0 ? null : spills / total }
}

/** The 5 h windows of every account pooled: the unused capacity and the wait the strip reads. */
export function windowFacts(windows: readonly RoutingWindow[]) {
  const five = windows.filter((w) => w.window === 'five_hour')
  return {
    resets: five.length,
    medianUnused: median(present(five.map((w) => w.unusedPct))),
    medianWait: median(present(five.map((w) => w.minutesToFirstPick))),
    neverPicked: five.filter((w) => w.firstPickAt === null).length,
  }
}

export type TuningRow = {
  account: string
  title: string
  fiveResets: number
  fiveUnused: number | null
  sevenResets: number
  sevenUnused: number | null
  wait: number | null
  never: number
}

/** The accounts the routing data names, registry order first. */
export function routingAccounts(
  picks: readonly AccountPick[],
  quota: QuotaResponse['series'],
  summary: readonly RoutingWindowSummary[],
): string[] {
  return sortAccounts([
    ...picks.filter((p) => !isUnserved(p)).map((p) => p.picked),
    ...quota.map((s) => s.account),
    ...summary.map((s) => s.account),
  ])
}

/** One row per account: what its windows expired with and how long the picker took to come back. */
export function tuningRows(
  accounts: readonly string[],
  summary: readonly RoutingWindowSummary[],
  windows: readonly RoutingWindow[],
): TuningRow[] {
  return accounts.map((account) => {
    const five = summary.find((s) => s.account === account && s.window === 'five_hour')
    const seven = summary.find((s) => s.account === account && s.window === 'seven_day')
    const lastSeven = windows
      .filter((w) => w.account === account && w.window === 'seven_day')
      .toSorted((a, b) => Date.parse(b.resetAt) - Date.parse(a.resetAt))[0]
    return {
      account,
      title: accountTitle(account),
      fiveResets: five?.resets ?? 0,
      fiveUnused: five?.medianUnusedPct ?? null,
      sevenResets: seven?.resets ?? 0,
      sevenUnused: lastSeven?.unusedPct ?? null,
      wait: five?.medianMinutesToFirstPick ?? null,
      never: five?.neverPickedAfter ?? 0,
    }
  })
}

// ---------------------------------------------------------------------------------------------
// 5 h sawtooth
// ---------------------------------------------------------------------------------------------

/** One row per sample instant: the 5 h percent of every account that has one then. */
export type SawRow = { at: Date; pct: Readonly<Record<string, number | null>> }

export function fiveHourRows(series: QuotaResponse['series'], sinceMs: number): SawRow[] {
  const byInstant = new Map<number, Record<string, number | null>>()
  for (const s of series) {
    for (const p of s.points) {
      const at = Date.parse(p.at)
      if (Number.isNaN(at) || at < sinceMs) continue
      const row = byInstant.get(at) ?? {}
      row[s.account] = p.fiveHourPct
      byInstant.set(at, row)
    }
  }
  return [...byInstant]
    .toSorted(([a], [b]) => a - b)
    .map(([at, pct]) => ({ at: new Date(at), pct }))
}

export type ResetTick = { at: Date; account: string; window: 'five_hour' | 'seven_day' }

/** The resets that fall inside the drawn rows, oldest first. */
export function resetTicks(
  resets: QuotaResponse['resets'],
  fromMs: number,
  toMs: number,
): ResetTick[] {
  return resets
    .map((r) => ({ at: new Date(r.at), account: r.account, window: r.window }))
    .filter((r) => r.at.getTime() >= fromMs && r.at.getTime() <= toMs)
    .toSorted((a, b) => a.at.getTime() - b.at.getTime())
}
