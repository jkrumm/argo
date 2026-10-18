/** Format seconds as "X h Y min" or "Y min" (under an hour). */
export function formatReadTime(seconds: number): string {
  if (seconds <= 0) return '0 min'
  if (seconds < 60) return '< 1 min'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} h`
  return `${hours} h ${minutes} min`
}
