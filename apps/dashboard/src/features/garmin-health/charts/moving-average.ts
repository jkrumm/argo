/**
 * Trailing simple moving average. A day is `null` when fewer than `min` non-null samples fall in
 * its window, so early days don't render a misleading flat line. `round` snaps to one decimal.
 */
export function movingAverage(
  values: readonly (number | null)[],
  window: number,
  opts: { round?: boolean; min?: number } = {},
): (number | null)[] {
  const min = opts.min ?? Math.min(3, window)
  return values.map((_, i) => {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      const v = values[j]
      if (v === null || v === undefined || Number.isNaN(v)) continue
      sum += v
      count += 1
    }
    if (count < min) return null
    const avg = sum / count
    return opts.round ? Math.round(avg * 10) / 10 : avg
  })
}
