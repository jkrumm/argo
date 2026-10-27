/**
 * The change of a figure against the equally long window before it: a percentage, or the word `new`
 * when there was next to nothing before. The prior figures come from `/usage/split`. No React, no
 * queries.
 */
import { withUnit } from '../../lib/format'

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
