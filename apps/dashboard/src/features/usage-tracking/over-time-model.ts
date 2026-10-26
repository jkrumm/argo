/**
 * Pure derivations for section A (where it goes over time): the series labels, the four token-class
 * series merged from four `groupBy=none` timeseries, and the per-series totals the ranked legend
 * prints. No React, no queries.
 */
import { PAYER_LABELS, type PayerValue } from './accounts'
import { dayToDate } from './constants'
import { OTHER_KEY } from './model'
import type { TimePoint } from './types'
import type { UsageGroupBy } from '../../lib/window-stores'

/** The key the timeseries `top=N` fold sums the tail into. */
const API_FOLD_KEY = 'other'
/** The key of the single series a `groupBy=none` timeseries returns. */
const NONE_KEY = 'value'

/** How a group key reads in the legend, the tooltip and the list. */
export function seriesLabel(groupBy: UsageGroupBy, key: string): string {
  if (key === API_FOLD_KEY) return OTHER_KEY
  if (groupBy === 'payer') return PAYER_LABELS[key as PayerValue] ?? key
  return key
}

export const isFoldKey = (key: string): boolean => key === API_FOLD_KEY

type Buckets = ReadonlyArray<{ bucket: string; groups: Record<string, number | null> }>

/** Per key, the sum over every bucket, in the order of `keys`. */
export function keyTotals(
  points: readonly TimePoint[],
  keys: readonly string[],
): { key: string; value: number }[] {
  return keys.map((key) => ({
    key,
    value: points.reduce((sum, p) => sum + (p.groups[key] ?? 0), 0),
  }))
}

export const TOKEN_CLASSES = ['cacheRead', 'cacheWrite', 'input', 'output'] as const
export type TokenClass = (typeof TOKEN_CLASSES)[number]

/** One bucket of the tokens lens: the four classes, cache-read always its own figure. */
export type TokenPoint = { date: Date } & Record<TokenClass, number>

/**
 * Merge the four per-class `groupBy=none` timeseries into one point per bucket. Buckets are matched
 * by their day text, so a class that lacks a bucket reads 0 there instead of shifting the rest.
 */
export function tokenPoints(parts: Record<TokenClass, Buckets>): TokenPoint[] {
  const byBucket = new Map<string, Partial<Record<TokenClass, number>>>()
  for (const cls of TOKEN_CLASSES) {
    for (const b of parts[cls]) {
      const entry = byBucket.get(b.bucket) ?? {}
      entry[cls] = b.groups[NONE_KEY] ?? 0
      byBucket.set(b.bucket, entry)
    }
  }
  return [...byBucket.entries()]
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bucket, v]) => ({
      date: dayToDate(bucket),
      cacheRead: v.cacheRead ?? 0,
      cacheWrite: v.cacheWrite ?? 0,
      input: v.input ?? 0,
      output: v.output ?? 0,
    }))
}

export type TokenTotals = Record<TokenClass, number> & {
  /** Input + output + cache-write: what the model newly processed. */
  fresh: number
  /** Fresh + cache-read; a tooltip total, never the headline. */
  processed: number
}

export function tokenTotals(points: readonly TokenPoint[]): TokenTotals {
  const sum = (cls: TokenClass) => points.reduce((acc, p) => acc + p[cls], 0)
  const totals = {
    cacheRead: sum('cacheRead'),
    cacheWrite: sum('cacheWrite'),
    input: sum('input'),
    output: sum('output'),
  }
  const fresh = totals.input + totals.output + totals.cacheWrite
  return { ...totals, fresh, processed: fresh + totals.cacheRead }
}

/** The processed total of one bucket: what the tooltip prints under the four classes. */
export const processedOf = (p: TokenPoint): number =>
  p.cacheRead + p.cacheWrite + p.input + p.output

/** The tallest bucket's processed total: the reference a token axis picks its unit from. */
export const peakProcessed = (points: readonly TokenPoint[]): number =>
  points.reduce((peak, p) => Math.max(peak, processedOf(p)), 0)
