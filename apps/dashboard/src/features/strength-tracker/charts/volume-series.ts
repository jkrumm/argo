/** Keeps the series that draw at least one segment in `points`; an undrawn one earns no legend key. */
export function drawnSeries<T, S extends { getValue: (d: T) => number | null }>(
  series: S[],
  points: T[],
): S[] {
  return series.filter((s) => points.some((p) => (s.getValue(p) ?? 0) > 0))
}
