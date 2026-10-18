import { VISIBLE_DATE_MIN } from '../constants'
import { GAP_ORDER, useGapForm } from '../gap-ledger'
import { chartEmpty, gapLine, windowCopyDays } from '../model'
import type { SummaryParams } from '../types'

/**
 * A chart card's empty label for the page's selected window: `chartEmpty`'s sentence when it is the
 * first gap on the page in reading order (no strip cell carries the cadence), else its leading
 * clause. A gap registers only once the query has settled on this window, so a loading card never
 * takes the cadence from the one that is really empty.
 */
export function useChartEmpty(
  order: keyof typeof GAP_ORDER,
  metric: string,
  params: SummaryParams,
  state: { settled: boolean; empty: boolean },
): string | undefined {
  const gap = chartEmpty(metric, windowCopyDays(params, VISIBLE_DATE_MIN))
  const form = useGapForm(GAP_ORDER[order], state.settled && state.empty ? gap : null)
  return state.empty ? gapLine(gap, form) : undefined
}
