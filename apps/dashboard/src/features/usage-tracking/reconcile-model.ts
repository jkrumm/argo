/**
 * Section D, portal vs tracked: the words and shapes for one `iu-reconcile` response. The API owns
 * the verdict (`flagged`: off by more than max($1, 20 %) of the portal figure, the rule of
 * `make budget`) and the `partial` newest day; this file only shapes them for the strip.
 */
import type { IuReconcile } from '../../lib/queries/usage'
import { dayToDate } from './constants'
import { deltaDirection } from './budget-model'
import { fmtUsdWhole } from './model'

export const RECON_WINDOW_DAYS = 30
export const RECON_NO_PORTAL = 'connect the portal sync'

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

export const unpricedNote = (rows: number): string =>
  `${rows} IU ${rows === 1 ? 'row' : 'rows'} unpriced (no cost recorded)`
