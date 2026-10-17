import { relativeTime as basaltRelativeTime } from 'basalt-ui/format'

export const APP_LOCALE = 'en-GB'

type RelativeTime = typeof basaltRelativeTime

/** Wraps a `relativeTime` so every call carries the app locale unless the caller names one. */
export function pinLocale(base: RelativeTime): RelativeTime {
  return (value, options = {}) => base(value, { ...options, locale: options.locale ?? APP_LOCALE })
}

/**
 * basalt-ui 2.18's `relativeTime` builds its `Intl.RelativeTimeFormat` from the call's own `locale`
 * only and skips the provider's default, so on a German system it reads "vor 4 Tagen" under
 * `locale="en-GB"`. Pin the app locale here until basalt honours it (docs/design/UPSTREAM.md).
 */
export const relativeTime = pinLocale(basaltRelativeTime)
