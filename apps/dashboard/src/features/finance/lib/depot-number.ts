/**
 * How the depot page writes numbers: German grouping and decimals everywhere (price scale, crosshair, readout,
 * header, line labels, trade cards, tables, inputs), a real minus sign, and one precision rule by magnitude.
 * Pure functions; the chart and the page import them, nothing here knows a chart.
 */

const LOCALE = 'de-DE'
const MINUS = '−'

const formats = new Map<string, Intl.NumberFormat>()
function format(min: number, max: number): Intl.NumberFormat {
  const key = `${min}:${max}`
  let known = formats.get(key)
  if (known === undefined) {
    known = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    })
    formats.set(key, known)
  }
  return known
}

/** A number with Intl's hyphen swapped for the minus sign. */
const withMinus = (text: string): string => text.replace('-', MINUS)

/** Decimals a price is read with: whole from 1,000, cents from 10, three from 1, four below. */
export function priceDigits(price: number): number {
  const size = Math.abs(price)
  if (size >= 1000) return 0
  if (size >= 10) return 2
  if (size >= 1) return 3
  return 4
}

/** A price on an axis, in a readout or in a table: `95.000`, `182,40`, `4,812`, `0,3125`. */
export const priceDe = (price: number): string => {
  const digits = priceDigits(price)
  return withMinus(format(digits, digits).format(price))
}

/** A price as a label: the same precision, trailing zeros dropped (`182`, `182,5`). */
export const priceTrimmed = (price: number): string =>
  withMinus(format(0, priceDigits(price)).format(price))

const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$' }

/** A price with its currency symbol after it, the German way: `182,5 €`, `95.000 $`. Trailing zeros dropped. */
export const moneyDe = (price: number, currency: string): string =>
  `${priceTrimmed(price)} ${SYMBOLS[currency] ?? currency}`

/** An amount of units (shares, coins): up to four decimals. */
export const quantityDe = (quantity: number): string => withMinus(format(0, 4).format(quantity))

/** A turnover on the volume axis: `12 Mio.`. */
const compact = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 })
export const compactDe = (value: number): string => compact.format(value)

/** An index level: points, no unit; one decimal below 1,000. */
export const levelDe = (level: number): string =>
  format(level < 1000 ? 1 : 0, level < 1000 ? 1 : 0).format(level)

/**
 * A fraction as a percent: `−18,3 %`, with a real minus sign and one decimal. `signed` adds a plus to a gain;
 * a value that rounds to zero carries no sign.
 */
export function percentDe(fraction: number, signed = false): string {
  const text = format(1, 1).format(Math.abs(fraction) * 100)
  if (Number(text.replace(',', '.')) === 0) return `${text} %`
  const sign = fraction < 0 ? MINUS : signed ? '+' : ''
  return `${sign}${text} %`
}

/** A day (epoch seconds, UTC midnight) as `24.11.2026`. */
const day = new Intl.DateTimeFormat(LOCALE, {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
export const dayDe = (seconds: number): string => day.format(new Date(seconds * 1000))

/**
 * A price typed by the owner. A comma is the decimal separator and dots are grouping (`95.000,5`); without a
 * comma, a dot followed by exactly three digits per group is a thousands separator (`95.000`) and any other dot
 * is a decimal point (`150.5`). `null` for nothing or something that is not a positive number.
 */
export function parseDecimal(text: string): number | null {
  const typed = text.replaceAll(/[\s€$]/g, '')
  if (!/^\d[\d.,]*$/.test(typed)) return null
  let plain: string
  if (typed.includes(',')) {
    if (typed.split(',').length > 2) return null
    plain = typed.replaceAll('.', '').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(typed)) {
    plain = typed.replaceAll('.', '')
  } else {
    plain = typed
  }
  const value = Number(plain)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** A price as it sits in an input: grouping, comma, at most four decimals (`95.000`, `150,5`). */
export const decimalText = (value: number): string => format(0, 4).format(value)

/** Cents as euros, German style: whole euros from 10 up unless `exact`; `1.234 €`, `12,99 €`, `−340 €`. */
export function eurDe(cents: number, exact = false): string {
  const digits = exact || Math.abs(cents) < 1000 ? 2 : 0
  return `${withMinus(format(digits, digits).format(cents / 100))} €`
}

/** A signed amount for a change or a net: `+1.200 €` / `−340 €`. */
export const signedEurDe = (cents: number): string =>
  cents === 0 ? eurDe(0) : `${cents > 0 ? '+' : MINUS}${eurDe(Math.abs(cents))}`

/** A change with its direction as a glyph: `▲ 1.200 €` / `▼ 340 €`; zero reads plain. */
export const deltaEurDe = (cents: number): string =>
  cents === 0 ? eurDe(0) : `${cents > 0 ? '▲' : '▼'} ${eurDe(Math.abs(cents))}`

/** A `YYYY-MM-DD` day as `24.11.2026`. */
export const isoDayDe = (iso: string): string => dayDe(Date.parse(`${iso}T00:00:00Z`) / 1000)
