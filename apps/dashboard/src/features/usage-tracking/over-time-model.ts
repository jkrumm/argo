/**
 * Pure derivations for section A (where it goes over time): the series labels and the per-series
 * totals the ranked legend prints. No React, no queries.
 */
import { PAYER_LABELS, type PayerValue } from './accounts'
import { OTHER_KEY } from './model'
import type { TimePoint } from './types'
import type { UsageGroupBy } from '../../lib/window-stores'

/** The key the timeseries `top=N` fold sums the tail into. */
const API_FOLD_KEY = 'other'

/** How a group key reads in the legend, the tooltip and the list. */
export function seriesLabel(groupBy: UsageGroupBy, key: string): string {
  if (key === API_FOLD_KEY) return OTHER_KEY
  if (groupBy === 'payer') return PAYER_LABELS[key as PayerValue] ?? key
  return key
}

export const isFoldKey = (key: string): boolean => key === API_FOLD_KEY

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
