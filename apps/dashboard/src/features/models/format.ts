/** Number formats of the models page. `≈` marks an estimate wherever one is printed. */
import { NBSP } from '../../lib/format'

export const EM_DASH = '—'
export const APPROX = '≈'

/** Dollars at the precision the figure needs: `$0.005`, `$0.071`, `$0.16`, `$2.45`, `$12`. */
export function fmtUsd(value: number | null): string {
  if (value === null) return EM_DASH
  if (value === 0) return '$0'
  if (value < 0.1) return `$${value.toFixed(3)}`
  if (value < 10) return `$${value.toFixed(2)}`
  return `$${Math.round(value)}`
}

/** A price per 1M tokens: `$5`, `$0.5`, `$0.05`. */
export function fmtPrice(value: number | null): string {
  if (value === null) return EM_DASH
  if (value >= 10) return `$${Math.round(value)}`
  return `$${Number(value.toFixed(2))}`
}

/** `52k`, `1.2M` — a token count with its `≈` when it is an estimate. */
export function fmtTokens(value: number | null, estimate = true): string {
  if (value === null) return EM_DASH
  const mark = estimate ? APPROX : ''
  if (value >= 1_000_000) return `${mark}${Number((value / 1_000_000).toFixed(1))}M`
  if (value >= 1000) return `${mark}${Math.round(value / 1000)}k`
  return `${mark}${Math.round(value)}`
}

/** `≈45 s`, `≈11 min`, `≈1.4 h` from seconds. */
export function fmtSeconds(value: number | null, estimate = true): string {
  if (value === null) return EM_DASH
  const mark = estimate ? APPROX : ''
  if (value < 90) return `${mark}${Math.round(value)}${NBSP}s`
  if (value < 5400) return `${mark}${Math.round(value / 60)}${NBSP}min`
  return `${mark}${Number((value / 3600).toFixed(1))}${NBSP}h`
}

/** An axis tick of the time chart (minutes): `0.5 min`, `10 min`, `2 h`. */
export function fmtMinuteTick(minutes: number): string {
  if (minutes >= 120) return `${Number((minutes / 60).toFixed(1))}${NBSP}h`
  return `${Number(minutes.toFixed(2))}${NBSP}min`
}

/** An axis tick of the token chart: `10k`, `1M`. */
export function fmtTokenTick(tokens: number): string {
  return fmtTokens(tokens, false)
}

/** `+8.3 pts` / `-1.2 pts`. */
export const fmtPoints = (delta: number): string =>
  `${delta >= 0 ? '+' : '-'}${Math.abs(delta).toFixed(1)}${NBSP}pts`

/** `×0.37`, `×1.1`: two significant figures. */
export const fmtRatio = (ratio: number): string => `×${Number(ratio.toPrecision(2))}`

/**
 * Ticks of a log axis at 1-2-5 steps inside `[min, max]`. Over `maxCount` it thins to 1-5 and then to
 * the decades alone, so a phone gets fewer labels, never overlapping ones.
 */
export function logTicks(min: number, max: number, maxCount: number): number[] {
  if (!(min > 0) || !(max > min)) return []
  const firstExp = Math.floor(Math.log10(min))
  const lastExp = Math.ceil(Math.log10(max))
  const within = (mantissas: readonly number[]): number[] => {
    const out: number[] = []
    for (let exp = firstExp; exp <= lastExp; exp++) {
      for (const m of mantissas) {
        const value = Number((m * 10 ** exp).toPrecision(12))
        if (value >= min * 0.9999 && value <= max * 1.0001) out.push(value)
      }
    }
    return out
  }
  for (const mantissas of [[1, 2, 5], [1, 5], [1]] as const) {
    const ticks = within(mantissas)
    if (ticks.length <= maxCount) return ticks
  }
  const decades = within([1])
  const step = Math.ceil(decades.length / maxCount)
  return decades.filter((_, i) => i % step === 0)
}

/**
 * A lineage name without its vendor prefix, the same rule for every lineage (`GPT-6.1 Terra` is
 * `Terra`, `GPT-6.1 Sol` is `Sol`, `Claude Opus 5.5` is `Opus 5.5`). For chart labels only: two
 * lineages can read the same (`GPT-6 Sol` and `GPT-6.1 Sol`), so the tooltip, the tables and the
 * verdicts use the full name.
 */
export const shortLineage = (lineage: string): string =>
  lineage.replace(/^(?:Claude|GPT-[\d.]+)\s+/, '')
