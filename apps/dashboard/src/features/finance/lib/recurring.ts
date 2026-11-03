import type { RecurringRow } from '../api/types'

/** What one charge of a series costs (positive cents): the latest for a subscription, the mean for a bill. */
export const chargeCents = (r: RecurringRow): number =>
  -(r.kind === 'subscription' ? r.current_cents : r.avg_cents)

/** Per month, positive cents. */
export const monthlyCents = (r: RecurringRow): number => -r.monthly_cents

export const isExcluded = (r: RecurringRow): boolean => r.override?.mode === 'exclude'

/** In the lists that count: running and not excluded by hand. */
export const isLive = (r: RecurringRow): boolean => r.status === 'active' && !isExcluded(r)

export const seatLabel = (r: RecurringRow): string | null =>
  r.series_count > 1 ? `Seat ${r.series} of ${r.series_count}` : null

export const CADENCE_LABEL: Record<RecurringRow['cadence'], string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
}

export type RecurringTotals = {
  subscriptionsMonthly: number
  subscriptionsYearly: number
  billsMonthly: number
  subscriptionCount: number
  billCount: number
}

/** Totals over the live rows: subscriptions and bills apart (a bill's figure is an average). */
export function recurringTotals(rows: readonly RecurringRow[]): RecurringTotals {
  const live = rows.filter(isLive)
  const subs = live.filter((r) => r.kind === 'subscription')
  const bills = live.filter((r) => r.kind === 'bill')
  const sum = (list: readonly RecurringRow[]) => list.reduce((s, r) => s + monthlyCents(r), 0)
  return {
    subscriptionsMonthly: sum(subs),
    subscriptionsYearly: sum(subs) * 12,
    billsMonthly: sum(bills),
    subscriptionCount: subs.length,
    billCount: bills.length,
  }
}

/** Live charges expected on or before `until` (a `YYYY-MM-DD`), soonest first. */
export function upcoming(
  rows: readonly RecurringRow[],
  today: string,
  until: string,
): RecurringRow[] {
  return rows
    .filter((r) => isLive(r) && r.next_expected_on !== null && r.next_expected_on <= until)
    .toSorted((a, b) => (a.next_expected_on ?? '').localeCompare(b.next_expected_on ?? ''))
    .map((r) => ({
      ...r,
      next_expected_on:
        r.next_expected_on !== null && r.next_expected_on < today ? today : r.next_expected_on,
    }))
}
