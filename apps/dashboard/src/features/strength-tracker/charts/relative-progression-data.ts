import type { ChartSeries } from 'basalt-ui/charts'

export type RelPoint = {
  day: Date
  pct: Record<string, number | null>
}

const PAD = 1.15
const MIN_SPAN = 10

/** Fits the visible data, 0 always inside, padded 15% — symmetric only when the data is. A span
 * under 10 points widens upward so a flat window doesn't amplify to a razor-thin band; `nice: true`
 * on the axis rounds the resulting bounds. */
export function pctDomain(
  data: readonly RelPoint[],
  visible: readonly ChartSeries<RelPoint>[],
): [number, number] {
  let min = 0
  let max = 0
  let seen = false
  for (const d of data) {
    for (const s of visible) {
      const v = s.getValue(d)
      if (v === null) continue
      seen = true
      min = Math.min(min, v)
      max = Math.max(max, v)
    }
  }
  if (!seen) return [-20, 20]
  const lo = min * PAD
  const hi = Math.max(max * PAD, lo + MIN_SPAN)
  return [lo, hi]
}
