/** The app locale, passed to `BasaltProvider`; basalt's formatters (incl. `relativeTime`) fall back to it. */
export const APP_LOCALE = 'en-GB'

/** No-break space: keeps a value on the same line as its unit at narrow widths. */
export const NBSP = ' '

/** `28 d`, `1.2 kg/wk` — a value joined to its unit with a no-break space, so a wrap never splits them. */
export const withUnit = (value: string | number, unit: string): string => `${value}${NBSP}${unit}`

/**
 * The one duration spelling: `21 d 4 h`, `5 h 12 min`, `42 min`. A whole larger unit drops its zero
 * tail (`21 d`, `5 h`), minutes are `min`, and a value and its unit never split. A non-finite or
 * negative value is `—`.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const totalMinutes = Math.round(ms / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts = (big: [number, string], small: [number, string]) =>
    small[0] === 0 ? withUnit(...big) : `${withUnit(...big)} ${withUnit(...small)}`
  if (days > 0) return parts([days, 'd'], [hours, 'h'])
  if (hours > 0) return parts([hours, 'h'], [minutes, 'min'])
  return withUnit(minutes, 'min')
}

/** `5 min ago`, or `just now` under a minute; `—` for a bad duration. */
export function formatAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  return ms < 60_000 ? 'just now' : `${formatDuration(ms)} ago`
}
