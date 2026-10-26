/**
 * Pure derivations for the headline, the over-time chart and the ranked lists: every one of them
 * reads a day-grain timeseries and splits it into the selected window and the equally long window
 * before it, so a total and its delta always come from the same buckets. No React, no queries.
 */
import { startOfDay, subDays } from 'date-fns'
import { withUnit } from '../../lib/format'
import type { Range } from '../../lib/queries/usage'
import { dayToDate } from './constants'
import { OTHER_KEY } from './model'

type Buckets = ReadonlyArray<{ bucket: string; groups: Record<string, number | null> }>

const RANGE_DAYS: Record<Range, number | null> = { '7d': 7, '30d': 30, '90d': 90, all: null }

/** The window the page asks for to see `range` and the one before it (`all` has no prior). */
const WIDER_RANGE: Record<Range, Range> = { '7d': '30d', '30d': '90d', '90d': 'all', all: 'all' }
export const priorRange = (range: Range): Range => WIDER_RANGE[range]

/** The key the timeseries `top=N` fold sums the tail into. */
export const FOLD_KEY = 'other'

export type PeriodSums = {
  current: Map<string, number>
  /** `null` when the range has no window before it, or the series does not reach back that far. */
  prior: Map<string, number> | null
}

function addInto(into: Map<string, number>, groups: Record<string, number | null>): void {
  for (const [key, value] of Object.entries(groups)) {
    into.set(key, (into.get(key) ?? 0) + (value ?? 0))
  }
}

/**
 * Per key, the sum over the last `range` COMPLETE days and over the same number of days before: the
 * running day is left out of both, or the current window would read as a drop against full days. The
 * series must come from the wider range (`priorRange`), which is dense: a key absent from it was
 * folded into `other` by the API, not zero.
 */
export function periodSums(buckets: Buckets, range: Range, now: number): PeriodSums {
  const days = RANGE_DAYS[range]
  const current = new Map<string, number>()
  if (days === null) {
    for (const b of buckets) addInto(current, b.groups)
    return { current, prior: null }
  }
  const today = startOfDay(now)
  const currentStart = subDays(today, days)
  const priorStart = subDays(currentStart, days)
  const first = buckets[0]
  const reaches = first !== undefined && dayToDate(first.bucket) <= priorStart
  const prior = reaches ? new Map<string, number>() : null
  for (const b of buckets) {
    const day = dayToDate(b.bucket)
    if (day >= today) continue
    if (day >= currentStart) addInto(current, b.groups)
    else if (prior !== null && day >= priorStart) addInto(prior, b.groups)
  }
  return { current, prior }
}

export const sumOf = (m: ReadonlyMap<string, number> | null): number | null =>
  m === null ? null : [...m.values()].reduce((a, b) => a + b, 0)

/** Past this multiple of the prior window a percentage stops being information: the row is `new`. */
const NEW_AT_RATIO = 10

export type Change = { kind: 'pct'; pct: number } | { kind: 'new' }

/**
 * Change against the prior window: a percentage, `new` when there was next to nothing before (or the
 * figure grew tenfold), `null` without a prior window or without anything now.
 */
export function change(current: number, prior: number | null): Change | null {
  if (prior === null || current <= 0) return null
  if (prior <= 0 || current / prior > NEW_AT_RATIO) return { kind: 'new' }
  return { kind: 'pct', pct: ((current - prior) / prior) * 100 }
}

export const fmtPctChange = (v: number): string => withUnit(Math.round(Math.abs(v)), '%')

/** `null`: the API folded this key away in that metric's series, so there is no figure to show. */
export type RankedRow = {
  key: string
  cost: number | null
  tokens: number | null
  costPrior: number | null
  tokensPrior: number | null
}

/**
 * The rows of a ranked list: every key of the lens's own series ranked by its current-window value,
 * the first `limit` kept and the rest (plus the API's fold key) summed into `Other`. A key the other
 * metric folded away has no figure there (`null`).
 */
export function rankRows({
  cost,
  tokens,
  lens,
  limit,
}: {
  cost: PeriodSums
  tokens: PeriodSums
  lens: 'spend' | 'tokens'
  limit: number
}): RankedRow[] {
  const lensSums = lens === 'spend' ? cost : tokens
  const read = (sums: PeriodSums, key: string) => ({
    now: sums.current.get(key) ?? null,
    before: sums.prior?.get(key) ?? null,
  })
  const rowOf = (key: string): RankedRow => {
    const c = read(cost, key)
    const t = read(tokens, key)
    return { key, cost: c.now, tokens: t.now, costPrior: c.before, tokensPrior: t.before }
  }
  const value = (r: RankedRow) => (lens === 'spend' ? r.cost : r.tokens) ?? 0
  const named = [...lensSums.current.keys()]
    .filter((k) => k !== FOLD_KEY)
    .map(rowOf)
    .toSorted((a, b) => value(b) - value(a))
  const head = named.slice(0, limit)
  const rest = [...named.slice(limit), ...(lensSums.current.has(FOLD_KEY) ? [rowOf(FOLD_KEY)] : [])]
  if (rest.length === 0) return head
  const sum = (pick: (r: RankedRow) => number | null) =>
    rest.some((r) => pick(r) === null) ? null : rest.reduce((a, r) => a + (pick(r) ?? 0), 0)
  return [
    ...head,
    {
      key: OTHER_KEY,
      cost: sum((r) => r.cost),
      tokens: sum((r) => r.tokens),
      costPrior: sum((r) => r.costPrior),
      tokensPrior: sum((r) => r.tokensPrior),
    },
  ]
}
