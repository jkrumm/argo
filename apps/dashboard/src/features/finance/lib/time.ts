import { APP_LOCALE } from '../../../lib/format'
import { localDayKey } from '../../../lib/local-day'

/** `3 Nov, 14:32` in the app's locale; the unlock throttle's "until" time. */
export const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString(APP_LOCALE, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

/** `YYYY-MM-DD` of a date in the browser's local day. */
export const isoDay = (d: Date): string => localDayKey(d)

/** `YYYY-MM-DD` plus `days`, in local days. */
export function addDays(iso: string, days: number): string {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number)
  return isoDay(new Date(y, m - 1, d + days))
}
