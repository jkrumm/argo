/** Pure helpers of `ScheduleRow` (kept React-free so they are unit-testable). */

/** `45` → `45m`, `90` → `1h 30m`, `120` → `2h`. Non-finite or negative input reads `—`. */
export function formatDurationMin(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—'
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
