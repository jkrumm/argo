/** The app locale, passed to `BasaltProvider`; basalt's formatters (incl. `relativeTime`) fall back to it. */
export const APP_LOCALE = 'en-GB'

/** No-break space: keeps a value on the same line as its unit at narrow widths. */
export const NBSP = ' '

/** `28 d`, `1.2 kg/wk` — a value joined to its unit with a no-break space, so a wrap never splits them. */
export const withUnit = (value: string | number, unit: string): string => `${value}${NBSP}${unit}`
