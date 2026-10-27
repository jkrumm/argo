/**
 * The Claude Max comparison: one row per subscription and a summed row. The value multiple is the
 * list value of the usage over the plan price prorated to the days the subscription was held in the
 * range: the range, or the days since its first row when it started later (a subscription bought
 * four days ago is not charged a whole month). No React, no queries.
 */
import { PLAN_PRICE_USD, type SubWallet } from './accounts'

const DAY_MS = 86_400_000
const DAYS_PER_MONTH = 30

type Buckets = ReadonlyArray<{ bucket: string; groups: Record<string, number | null> }>
type Total = { payer: string; cost: number; fresh: number; cacheRead: number }
type RangeKey = '7d' | '30d' | '90d' | 'all'

export const RANGE_DAYS: Record<Exclude<RangeKey, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

export type ComparedRow = {
  key: string
  title: string
  /** `20x`; `—` for the summed row. */
  plan: string
  /** Plan price per month; the summed row adds them. */
  price: number
  /** Days the price is prorated over; `null` when `all` has no first row to count from. */
  days: number | null
  listValue: number
  /** List value ÷ (price × days / 30); `null` without usage or days. */
  multiple: number | null
  fresh: number
  cacheRead: number
  activeDays: number
  /** Highest weekly quota percent in the range; `null` without samples. */
  quotaPeak: number | null
}

/** List value over the prorated price, or `null` when either side has nothing to divide. */
export function valueMultiple(
  listValue: number,
  priceUsd: number,
  days: number | null,
): number | null {
  if (days === null || days <= 0 || priceUsd <= 0 || listValue <= 0) return null
  return listValue / ((priceUsd * days) / DAYS_PER_MONTH)
}

/** The first bucket (`YYYY-MM-DD`, UTC) where `has` holds, or `null`. */
function firstDay(buckets: Buckets, has: (b: Buckets[number]) => boolean): string | null {
  return buckets.find(has)?.bucket ?? null
}

/**
 * Days the subscription was held within the range: the days since its first row ever (that day
 * included), capped at the range; `null` without a first row.
 */
export function proratedDays(range: RangeKey, first: string | null, now: number): number | null {
  if (first === null) return null
  const start = Date.parse(first)
  if (Number.isNaN(start)) return null
  const held = Math.max(1, Math.ceil((now - start) / DAY_MS))
  return range === 'all' ? held : Math.min(RANGE_DAYS[range], held)
}

/** Whether a day bucket falls inside the range ending now. */
const inRange = (bucket: string, range: RangeKey, now: number): boolean =>
  range === 'all' || Date.parse(bucket) >= now - RANGE_DAYS[range] * DAY_MS

const used = (v: number | null | undefined): boolean => (v ?? 0) > 0

export function comparedRows({
  subs,
  totals,
  daily,
  held = daily,
  peaks,
  range,
  now,
}: {
  subs: readonly SubWallet[]
  totals: readonly Total[]
  /** All-time day buckets by payer (cost), workspace-filtered: the active days in the range. */
  daily: Buckets
  /** All-time day buckets by payer, unfiltered: each subscription's first row (days held). */
  held?: Buckets
  /** Weekly quota peak by account id. */
  peaks: Readonly<Record<string, number | null>>
  range: RangeKey
  now: number
}): { rows: ComparedRow[]; sum: ComparedRow } {
  const rows = subs.map((w): ComparedRow => {
    const total = totals.find((t) => t.payer === w.id)
    const price = PLAN_PRICE_USD[w.plan]
    const days = proratedDays(
      range,
      firstDay(held, (b) => used(b.groups[w.id])),
      now,
    )
    const listValue = total?.cost ?? 0
    return {
      key: w.id,
      title: w.title,
      plan: w.plan,
      price,
      days,
      listValue,
      multiple: valueMultiple(listValue, price, days),
      fresh: total?.fresh ?? 0,
      cacheRead: total?.cacheRead ?? 0,
      activeDays: daily.filter((b) => inRange(b.bucket, range, now) && used(b.groups[w.id])).length,
      quotaPeak: peaks[w.account] ?? null,
    }
  })

  const prorated = rows.reduce(
    (s, r) => s + (r.days === null ? 0 : (r.price * r.days) / DAYS_PER_MONTH),
    0,
  )
  const listValue = rows.reduce((s, r) => s + r.listValue, 0)
  const ids = subs.map((w) => w.id)
  const quotaPeaks = rows.flatMap((r) => (r.quotaPeak === null ? [] : [r.quotaPeak]))
  const sum: ComparedRow = {
    key: 'all',
    title: 'All Claude Max',
    plan: '—',
    price: rows.reduce((s, r) => s + r.price, 0),
    days: null,
    listValue,
    multiple: prorated > 0 && listValue > 0 ? listValue / prorated : null,
    fresh: rows.reduce((s, r) => s + r.fresh, 0),
    cacheRead: rows.reduce((s, r) => s + r.cacheRead, 0),
    activeDays: daily.filter(
      (b) => inRange(b.bucket, range, now) && ids.some((id) => used(b.groups[id])),
    ).length,
    quotaPeak: quotaPeaks.length === 0 ? null : Math.max(...quotaPeaks),
  }
  return { rows, sum }
}
