/**
 * The IU key detail's own words: when the key falls back under its cap. No React, no queries.
 */
import type { IuBudget } from '../../lib/queries/usage'
import { dayToDate } from './constants'
import { shortDay } from './model'

/** How far ahead the API projects the burn; past it a key that is over reads as "not within". */
export const UNDER_CAP_HORIZON_DAYS = 60

/**
 * `Under the cap around 12 Nov` while the key is over its cap and the projection (every future day at
 * the last seven days' burn) brings the rolling 30 days under it; a sentence of its own when it does
 * not within the horizon. `null` when there is no portal report (the zeros are not headroom) or the
 * key is not over its cap: the can-spend line already says how much room it has.
 */
export function underCapLine(
  b: Pick<IuBudget, 'underCapOn' | 'rolling30Usd' | 'limitUsd' | 'fetchedAt'>,
): string | null {
  if (b.fetchedAt === null) return null
  if (b.underCapOn !== null) return `Under the cap around ${shortDay(dayToDate(b.underCapOn))}`
  return b.rolling30Usd > b.limitUsd
    ? `Not under the cap within ${UNDER_CAP_HORIZON_DAYS} days at the last 7 days’ burn`
    : null
}

/** The info text of a key's limit card: what the meter is, or why there is none yet. */
export const iuKeyLimitInfo = (label: string, reported: boolean): string =>
  reported
    ? `${label} key spend over the rolling 30 days against the key's own $500 cap, from the IU portal report; the tick marks 80 %. The ink turns at 80 % and 100 %. The date is when the rolling sum drops to the cap, projecting every future day at the last 7 days' burn.`
    : `The ${label} key's cap is read from IU's portal report, which has not arrived yet: until it does, only the spend tracked so far is shown, never a meter.`
