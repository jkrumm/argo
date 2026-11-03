import { money, percent } from 'basalt-ui/format'
import { VX } from 'basalt-ui/tokens'
import type { Tone } from '../api/types'

const CURRENCY = 'EUR'

/** From this amount the cents are noise; below it a column would mix 12,99 € with 1.150 €. */
const WHOLE_EURO_FROM = 10

/** Cents as euros; whole euros from 10 up. */
export const eur = (cents: number): string =>
  money(cents / 100, {
    currency: CURRENCY,
    digits: Math.abs(cents) >= WHOLE_EURO_FROM * 100 ? 0 : 2,
  })

/** Cents as euros, always with cents: a booking is read to the cent. */
export const eurExact = (cents: number): string =>
  money(cents / 100, { currency: CURRENCY }).replace('-', '−')

/** Axis form: 12K €. */
export const eurCompact = (cents: number): string =>
  money(cents / 100, { currency: CURRENCY, compact: true })

/** A signed amount for a change or a net: +€1,200 / −€340. */
export function signedEur(cents: number): string {
  if (cents === 0) return eur(0)
  return `${cents > 0 ? '+' : '−'}${eur(Math.abs(cents))}`
}

/** A ratio (0.25) as `25 %`; `—` when there is none. */
export const ratio = (value: number | null): string =>
  value === null ? '—' : percent(value, { input: 'ratio' })

/** The status ink of a report tone. */
export const toneColor = (tone: Tone): string =>
  ({ good: VX.status.good, warn: VX.status.warn, bad: VX.status.bad, neutral: VX.status.neutral })[
    tone
  ]

/** The sign of a change as a tone: a loss or an overspend is `bad`. */
export const gainTone = (cents: number): 'good' | 'bad' | undefined =>
  cents === 0 ? undefined : cents > 0 ? 'good' : 'bad'

/** `gainTone` as an optional prop to spread, since an absent tone is not an `undefined` one. */
export const toneProp = (cents: number): { tone?: 'good' | 'bad' } => {
  const tone = gainTone(cents)
  return tone === undefined ? {} : { tone }
}

/** A change with its direction as a glyph: ▲ €1,200 / ▼ €340; zero reads plain. */
export function deltaEur(cents: number): string {
  if (cents === 0) return eur(0)
  return `${cents > 0 ? '▲' : '▼'} ${eur(Math.abs(cents))}`
}
