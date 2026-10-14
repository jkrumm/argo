/** The header badge's rule: the most recent point whose value is present, not merely the last row. */
export function latestWith<T>(points: readonly T[], get: (p: T) => number | null): T | null {
  return points.findLast((p) => get(p) !== null) ?? null
}
