/** The app locale, passed to `BasaltProvider`; basalt's formatters (incl. `relativeTime`) fall back to it. */
export const APP_LOCALE = 'en-GB'

/** No-break space: keeps a value on the same line as its unit at narrow widths. */
export const NBSP = ' '

/** An arrow with a no-break space each side, so a line never wraps right before or after it. */
export const ARROW = `${NBSP}→${NBSP}`

/** `28 d`, `1.2 kg/wk` — a value joined to its unit with a no-break space, so a wrap never splits them. */
export const withUnit = (value: string | number, unit: string): string => `${value}${NBSP}${unit}`

/**
 * The one duration spelling: `21 d 4 h`, `5 h 12 min`, `42 min`, `< 1 min`. A whole larger unit
 * drops its zero tail (`21 d`, `5 h`), minutes are `min`, and a value, its unit and a compound's two parts never split (`ago` / `in` stay breakable). A
 * non-finite or negative value is `—`. Warden's day-fraction ages (`formatAgeDays`, `formatSpan`)
 * keep their own decimal spelling.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms > 0 && ms < 60_000) return `<${NBSP}1${NBSP}min`
  const totalMinutes = Math.round(ms / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts = (big: [number, string], small: [number, string]) =>
    small[0] === 0 ? withUnit(...big) : `${withUnit(...big)}${NBSP}${withUnit(...small)}`
  if (days > 0) return parts([days, 'd'], [hours, 'h'])
  if (hours > 0) return parts([hours, 'h'], [minutes, 'min'])
  return withUnit(minutes, 'min')
}

/** {@link formatDuration} of a length given in minutes. */
export const formatMinutes = (minutes: number): string => formatDuration(minutes * 60_000)

/** `5 min ago`, or `just now` under a minute; `—` for a bad duration. */
export function formatAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  return ms < 60_000 ? 'just now' : `${formatDuration(ms)} ago`
}

/** A timestamp against `now`: `5 min ago`, `in 2 h`; `—` when it is not a readable time. */
export function formatRelative(iso: string, now: number): string {
  const diff = now - Date.parse(iso)
  if (!Number.isFinite(diff)) return '—'
  return diff >= 0 ? formatAgo(diff) : `in ${formatDuration(-diff)}`
}
