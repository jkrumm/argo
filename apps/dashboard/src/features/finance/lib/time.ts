import { APP_LOCALE } from '../../../lib/format'

/** `3 Nov, 14:32` in the app's locale; the unlock throttle's "until" time. */
export const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString(APP_LOCALE, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
