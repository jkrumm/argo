/**
 * The Credits tab's figures: the Claude API credit pools (one per subscription) laid out as a
 * burn-down against the cycle, the projected unspent credit, the routing picks and the cache-hit rate
 * per caller. The API does the arithmetic; this file orders, labels and colours it. A null reading
 * (no grant, no provider figure, an unknown cycle end) stays null and prints as `—`, never as 0. No
 * React, no queries.
 */
import { format as formatDate } from 'date-fns'
import { VX } from 'basalt-ui/tokens'
import { glue } from '../../lib/format'
import type { CreditCacheCaller, CreditPicksResponse, CreditPool } from './credit-queries'
import { PAYER_LABELS, USAGE_ACCOUNTS, type PayerValue } from './accounts'
import { colorForPayer, dayToDate } from './constants'
import { EM_DASH, fmtUsdWhole, shortDay } from './model'

/** The IU passthrough as `usage.gateway_picks.picked` spells it. */
export const IU_PASSTHROUGH = 'iu-api'
export const REFUSED = 'refused'

const ACCOUNT_IDS: readonly string[] = USAGE_ACCOUNTS.map((a) => a.id)

/** The credit payer of a pool (account) id; an id outside the registry is `unknown`. */
export const creditPayerOf = (account: string): PayerValue =>
  USAGE_ACCOUNTS.find((a) => a.id === account)?.creditPayer ?? 'unknown'

/** A pool's name: its payer label (`IU credit`), or the account id outside the registry. */
export const poolTitle = (account: string): string => {
  const payer = creditPayerOf(account)
  return payer === 'unknown' ? account : PAYER_LABELS[payer]
}

/** Registry order first, then any other id alphabetically. */
export function sortPools<T extends { account: string }>(pools: readonly T[]): T[] {
  const rank = (account: string) => {
    const i = ACCOUNT_IDS.indexOf(account)
    return i === -1 ? ACCOUNT_IDS.length : i
  }
  return pools.toSorted(
    (a, b) => rank(a.account) - rank(b.account) || a.account.localeCompare(b.account),
  )
}

// ── Burn-down ─────────────────────────────────────────────────────────────────────────────────

/** One day of the burn-down chart: the credit left by each source (null = no figure). */
export type BurnRow = { at: Date; metered: number | null; reported: number | null }

/** A running cycle has a balance to count down from; an ended one waits for its reconcile. */
export const hasBalance = (pool: CreditPool): boolean =>
  pool.grantUsd !== null && (pool.cycle.status === 'open' || pool.cycle.status === 'unknown-end')

/**
 * The chart rows: credit left by our meter and by the provider's report, per day of the axis. Without
 * a balance (no grant, or a cycle that already ended) there is nothing to count down from: no rows. The
 * days after today carry nulls, so the axis still runs to the cycle end.
 */
export function burnRows(pool: CreditPool): BurnRow[] {
  const grant = pool.grantUsd
  if (grant === null || !hasBalance(pool)) return []
  const left = (spent: number | null) => (spent === null ? null : grant - spent)
  return pool.points.map((p) => ({
    at: dayToDate(p.day),
    metered: left(p.meteredUsd),
    reported: left(p.reportedUsd),
  }))
}

/**
 * The chart's y-domain: zero to the grant, but a pool overspent by the provider's own report (spend
 * made outside the gateway) goes below zero, and the axis follows it instead of clipping the line.
 */
export function burnDomain(rows: readonly BurnRow[], grant: number): [number, number] {
  const lowest = rows.reduce(
    (min, r) => Math.min(min, r.metered ?? Infinity, r.reported ?? Infinity),
    0,
  )
  return [Math.min(0, lowest), Math.max(grant, 0)]
}

/** The subtitle of a pool: its cycle as days, or why it has none to show. */
export function cycleLabel(pool: CreditPool): string {
  const { status, start, end } = pool.cycle
  if (status === 'unknown-end') return 'cycle unknown · last 31 d'
  if (status === 'none' || start === null) return 'no cycle on record · last 31 d'
  if (end === null) return 'cycle unknown · last 31 d'
  // The cycle's days are UTC days (the axis the API draws), whatever zone the reader is in.
  const utcDayOf = (instant: number) => dayToDate(new Date(instant).toISOString().slice(0, 10))
  const days = `${shortDay(utcDayOf(Date.parse(start)))} – ${shortDay(utcDayOf(Date.parse(end) - 1))}`
  return status === 'awaiting-reconcile' ? `${days} · ended, awaiting reconcile` : days
}

/** What the burn-down chart counts: a cycle with no known end draws 31 days of a balance counted from its start. */
export function burnNote(pool: CreditPool): string {
  return pool.cycle.status === 'unknown-end'
    ? 'Cycle unknown: balance counted from the cycle start, chart shows the last 31 days only'
    : reportedNote(pool)
}

/** Dollars with cents below ten: a pool's balances are small enough that whole dollars hide the movement. */
export function fmtCredit(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EM_DASH
  return n < 10 && n > -10 ? `$${n.toFixed(2)}` : fmtUsdWhole(n)
}

/** `3 d 2 h` left in the cycle; `—` while the end is unknown. */
export function fmtDaysLeft(days: number | null): string {
  if (days === null) return EM_DASH
  const totalHours = Math.max(0, Math.round(days * 24))
  const whole = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  if (whole === 0) return `${hours} h`
  return hours === 0 ? `${whole} d` : `${whole} d ${hours} h`
}

/** The provider figure's age: `refreshed 14 Oct 09:00`, or why there is none. */
export function reportedNote(pool: CreditPool): string {
  if (!pool.reported.available) return 'Provider report not available yet'
  if (pool.reported.refreshedAt === null) return 'No provider report for this pool yet'
  return `Provider report refreshed ${glue(formatDate(new Date(pool.reported.refreshedAt), 'd MMM HH:mm'))}, lags by hours`
}

/**
 * The previous closed cycle as one sentence: what the provider reconciled and what expired unspent;
 * null when there is none. A cycle not yet reconciled says so.
 */
export function previousNote(pool: CreditPool): string | null {
  const prev = pool.previous
  if (prev === null) return null
  const end = prev.cycleEnd === null ? '' : ` (ended ${shortDay(new Date(prev.cycleEnd))})`
  if (prev.reconciledUsd === null && prev.unspentUsd === null) {
    return `Previous cycle${end}: ${fmtCredit(prev.meteredUsd)} metered, not reconciled yet`
  }
  return `Previous cycle${end}: ${fmtCredit(prev.reconciledUsd)} reconciled, ${fmtCredit(prev.unspentUsd)} unspent`
}

// ── Picks and fallbacks ───────────────────────────────────────────────────────────────────────

/** A pick target's name: a pool is its credit label, `iu-api` the IU API, `refused` itself. */
export function targetLabel(picked: string): string {
  if (picked === IU_PASSTHROUGH) return PAYER_LABELS['iu-api']
  if (picked === REFUSED) return 'Refused'
  return poolTitle(picked)
}

/** A pick target's ink: a pool its credit shade, the passthrough the IU API grey, a refusal the failure ink. */
export function targetColor(picked: string): string {
  if (picked === REFUSED) return VX.status.bad
  if (picked === IU_PASSTHROUGH) return colorForPayer('iu-api')
  return colorForPayer(creditPayerOf(picked))
}

/** The targets in drawing order: pools in registry order, then the passthrough, then refusals. */
export function sortTargets(targets: Iterable<string>): string[] {
  const rank = (t: string) => {
    if (t === REFUSED) return ACCOUNT_IDS.length + 2
    if (t === IU_PASSTHROUGH) return ACCOUNT_IDS.length + 1
    const i = ACCOUNT_IDS.indexOf(t)
    return i === -1 ? ACCOUNT_IDS.length : i
  }
  return [...new Set(targets)].toSorted((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

export type PickDay = { at: Date; counts: Readonly<Record<string, number>>; total: number }

/** The daily picks as one stacked row per day, by target, oldest first. */
export function pickDays(daily: CreditPicksResponse['daily']): PickDay[] {
  const byDay = new Map<string, Record<string, number>>()
  for (const d of daily) {
    const counts = byDay.get(d.day) ?? {}
    counts[d.picked] = (counts[d.picked] ?? 0) + d.count
    byDay.set(d.day, counts)
  }
  return [...byDay]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([day, counts]) => ({
      at: dayToDate(day),
      counts,
      total: Object.values(counts).reduce((sum, n) => sum + n, 0),
    }))
}

export type ReasonLine = {
  key: string
  picked: string
  reason: string
  count: number
  fallback: boolean
}

/** The pick cells as ranked lines; the fallback flag is the API's (`iu-api` for a reason other than forced). */
export function reasonLines(cells: CreditPicksResponse['cells']): ReasonLine[] {
  return cells
    .map((c) => ({
      key: `${c.picked}\u0000${c.reason}`,
      picked: c.picked,
      reason: c.reason,
      count: c.count,
      fallback: c.fallback,
    }))
    .toSorted((a, b) => b.count - a.count)
}

/** The share of picks that fell back; null without picks. */
export const fallbackShare = (fallbacks: number, total: number): number | null =>
  total > 0 ? fallbacks / total : null

// ── Cache ─────────────────────────────────────────────────────────────────────────────────────

/** The callers with a measurable hit rate first (best first), then the ones with no input at all. */
export function cacheRows(callers: readonly CreditCacheCaller[]): CreditCacheCaller[] {
  return callers.toSorted((a, b) => {
    if ((a.hitRate === null) !== (b.hitRate === null)) return a.hitRate === null ? 1 : -1
    return (
      (b.hitRate ?? 0) - (a.hitRate ?? 0) ||
      b.requests - a.requests ||
      a.caller.localeCompare(b.caller)
    )
  })
}

/** The token-weighted overall hit rate: total cache-read over total input + cache-read + cache-write. */
export function overallHitRate(callers: readonly CreditCacheCaller[]): number | null {
  const sum = callers.reduce(
    (acc, c) => ({
      input: acc.input + c.input,
      read: acc.read + c.cacheRead,
      write: acc.write + c.cacheWrite,
    }),
    { input: 0, read: 0, write: 0 },
  )
  const total = sum.input + sum.read + sum.write
  return total > 0 ? sum.read / total : null
}
