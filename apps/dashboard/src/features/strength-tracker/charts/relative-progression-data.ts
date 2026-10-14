import type { ChartSeries } from 'basalt-ui/charts'

export type RelPoint = {
  day: Date
  pct: Record<string, number | null>
}

/** Symmetric ± domain, floored at ±10% so a flat window doesn't amplify to a razor-thin band —
 * `nice: true` on the axis rounds the resulting bound. */
export function pctDomain(
  data: readonly RelPoint[],
  visible: readonly ChartSeries<RelPoint>[],
): [number, number] {
  const vals: number[] = []
  for (const d of data) {
    for (const s of visible) {
      const v = s.getValue(d)
      if (v !== null) vals.push(Math.abs(v))
    }
  }
  if (!vals.length) return [-20, 20]
  const maxAbs = Math.max(10, Math.max(...vals) * 1.15)
  return [-maxAbs, maxAbs]
}
