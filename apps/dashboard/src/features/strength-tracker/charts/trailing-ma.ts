/** Trailing moving average; null until `min` non-null values are present in the window. */
export function trailingMA(
  values: readonly (number | null)[],
  window: number,
  min = 3,
): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = 0; i < values.length; i++) {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      const v = values[j]
      if (v !== null && v !== undefined && !Number.isNaN(v)) {
        sum += v
        count += 1
      }
    }
    out.push(count >= min ? sum / count : null)
  }
  return out
}
