/** Format seconds as "Xh Ym" or "Ym" (under an hour). */
export function formatReadTime(seconds: number): string {
  if (seconds <= 0) return '0m'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

/** Pages per hour, rounded to nearest integer. Returns null when inputs are invalid. */
export function pagesPerHour(pages: number, seconds: number): number | null {
  if (pages <= 0 || seconds <= 0) return null
  return Math.round(pages / (seconds / 3600))
}
