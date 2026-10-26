/**
 * Section D, portal vs tracked: the words and shapes for one `iu-reconcile` response. The API owns
 * the verdict (`flagged`: off by more than max($1, 20 %) of the portal figure, the rule of
 * `make budget`) and the `partial` newest day; this file only shapes them for the charts.
 */
import type { IuReconcile } from '../../lib/queries/usage'
import { dayToDate } from './constants'
import { deltaDirection } from './budget-model'
import { fmtUsdWhole } from './model'

export const RECON_WINDOW_DAYS = 30
export const RECON_NO_PORTAL = 'connect the portal sync'
/** The model split is one window-level list: the API returns no per-day models. */
export const RECON_MODELS_NOTE =
  'Per-model split covers the whole window; the API returns no per-day model split.'
/** Models listed before the rest fold into one row. */
export const RECON_MODEL_ROWS = 8

const MINUS = '−'

export type ReconDay = {
  date: Date
  portalUsd: number
  trackedUsd: number
  deltaUsd: number
  ratio: number | null
  flagged: boolean
  partial: boolean
}

export const reconDays = (days: IuReconcile['days']): ReconDay[] =>
  days.map((d) => ({ ...d, date: dayToDate(d.day) }))

/** `+$12`, `−$41`, or `$0` when the gap rounds to under a dollar. */
export function fmtSignedUsd(deltaUsd: number): string {
  const direction = deltaDirection(deltaUsd)
  if (direction === 'flat') return fmtUsdWhole(0)
  const amount = fmtUsdWhole(Math.abs(deltaUsd))
  return direction === 'up' ? `+${amount}` : `${MINUS}${amount}`
}

/** `0.42×` tracked per portal dollar; `—` on a day the portal reported nothing. */
export const fmtRatio = (ratio: number | null): string =>
  ratio === null ? '—' : `${ratio.toFixed(2)}×`

/** `−$41 · 0.42×`: the reading both charts print for a day. */
export const dayReading = (d: Pick<ReconDay, 'deltaUsd' | 'ratio'>): string =>
  `${fmtSignedUsd(d.deltaUsd)} · ${fmtRatio(d.ratio)}`

export type ModelRow = { label: string; portalUsd: number; trackedUsd: number }

export const OTHER_MODELS = 'Other'

/** The first `limit` models as the API ranks them, the tail summed into one `Other` row. */
export function modelRows(models: IuReconcile['models'], limit = RECON_MODEL_ROWS): ModelRow[] {
  if (models.length <= limit) return [...models]
  const rest = models.slice(limit)
  return [
    ...models.slice(0, limit),
    {
      label: OTHER_MODELS,
      portalUsd: rest.reduce((sum, m) => sum + m.portalUsd, 0),
      trackedUsd: rest.reduce((sum, m) => sum + m.trackedUsd, 0),
    },
  ]
}

/** Whole-dollar shares of `values` that add up to `Math.round(sum)`: floors, then the leftover dollars go to the largest fractions. */
function apportion(values: readonly number[]): number[] {
  const floors = values.map(Math.floor)
  const leftover =
    Math.round(values.reduce((sum, v) => sum + v, 0)) - floors.reduce((a, b) => a + b, 0)
  const byFraction = values
    .map((v, i) => ({ i, fraction: v - Math.floor(v) }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i)
  for (let k = 0; k < leftover; k++) floors[byFraction[k % byFraction.length]!.i]! += 1
  return floors
}

/**
 * The model table and the headline from ONE rounding: every figure is a whole dollar, the rows add
 * up to the totals and each row's delta is the difference of the figures beside it.
 */
export function wholeDollarTable(rows: readonly ModelRow[]): {
  rows: ModelRow[]
  portalUsd: number
  trackedUsd: number
} {
  const portal = apportion(rows.map((r) => r.portalUsd))
  const tracked = apportion(rows.map((r) => r.trackedUsd))
  return {
    rows: rows.map((r, i) => ({ label: r.label, portalUsd: portal[i]!, trackedUsd: tracked[i]! })),
    portalUsd: portal.reduce((a, b) => a + b, 0),
    trackedUsd: tracked.reduce((a, b) => a + b, 0),
  }
}

export const unpricedNote = (rows: number): string =>
  `${rows} IU ${rows === 1 ? 'row' : 'rows'} unpriced (no cost recorded)`
