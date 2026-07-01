// ─── Date helpers (private) ──────────────────────────────────────────────────

function parseDate(yyyyMmDd: string): Date {
  // Use UTC midnight to keep arithmetic timezone-agnostic.
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!))
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(yyyyMmDd: string, n: number): string {
  const d = parseDate(yyyyMmDd)
  d.setUTCDate(d.getUTCDate() + n)
  return formatDate(d)
}

function diffDays(a: string, b: string): number {
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / 86_400_000)
}

/** OLS slope. Returns null when fewer than 2 points or zero variance in x. */
function linearSlope(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 2) return null
  const n = pairs.length
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n
  const my = pairs.reduce((a, p) => a + p[1], 0) / n
  let num = 0
  let den = 0
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my)
    den += (x - mx) ** 2
  }
  if (den === 0) return null
  return num / den
}

// ─── Skinfold formulas ────────────────────────────────────────────────────────

/** Mean of a single date's readings, rounded to 1 decimal. */
export function sessionAverage(readings: { value_mm: number }[]): number {
  const sum = readings.reduce((a, r) => a + r.value_mm, 0)
  return Math.round((sum / readings.length) * 10) / 10
}

/**
 * Linear regression slope (mm/day) over dated skinfold averages. Returns null
 * if fewer than 2 points or the span is < 3 days (insufficient signal).
 */
function skinfoldSlope(points: Array<{ date: string; value: number }>): number | null {
  if (points.length < 2) return null
  const sorted = [...points].toSorted((a, b) => a.date.localeCompare(b.date))
  const base = sorted[0]!.date
  const span = diffDays(sorted[sorted.length - 1]!.date, base)
  if (span < 3) return null
  const pairs: Array<[number, number]> = sorted.map((p) => [diffDays(p.date, base), p.value])
  return linearSlope(pairs)
}

/**
 * Trailing 28-day rate (mm/week). Falls back to all-time slope when the
 * trailing window has fewer than 2 points.
 */
export function trailingRatePerWeek(points: Array<{ date: string; value: number }>): number | null {
  if (points.length < 2) return null
  const sorted = [...points].toSorted((a, b) => a.date.localeCompare(b.date))
  const last = sorted[sorted.length - 1]!.date
  const cutoff = addDays(last, -28)
  const window = sorted.filter((p) => p.date >= cutoff)
  const slope = skinfoldSlope(window.length >= 2 ? window : sorted)
  return slope === null ? null : slope * 7
}

/** Classification of |mm/week|: <0.1 stable, else reducing (negative) or increasing (positive). */
export function classifySkinfoldDirection(
  mmPerWeek: number | null,
): 'reducing' | 'increasing' | 'stable' {
  if (mmPerWeek === null) return 'stable'
  if (Math.abs(mmPerWeek) < 0.1) return 'stable'
  return mmPerWeek < 0 ? 'reducing' : 'increasing'
}
