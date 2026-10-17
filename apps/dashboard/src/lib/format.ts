import { relativeTime as basaltRelativeTime } from 'basalt-ui/format'

export const APP_LOCALE = 'en-GB'

type RelativeTimeArgs = Parameters<typeof basaltRelativeTime>

/**
 * basalt-ui 2.18's `relativeTime` builds its `Intl.RelativeTimeFormat` from the call's own `locale`
 * only and skips the provider's default, so on a German system it reads "vor 4 Tagen" under
 * `locale="en-GB"`. Pin the app locale here until basalt honours it (docs/design/UPSTREAM.md).
 */
export function relativeTime(
  value: RelativeTimeArgs[0],
  options: RelativeTimeArgs[1] = {},
): string {
  return basaltRelativeTime(value, { locale: APP_LOCALE, ...options })
}
