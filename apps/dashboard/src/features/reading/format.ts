import { withUnit } from '../../lib/format'

/** Format seconds as "X h Y min" or "Y min" (under an hour). */
export function formatReadTime(seconds: number): string {
  if (seconds <= 0) return withUnit(0, 'min')
  if (seconds < 60) return withUnit('< 1', 'min')
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours === 0) return withUnit(minutes, 'min')
  if (minutes === 0) return withUnit(hours, 'h')
  return `${withUnit(hours, 'h')} ${withUnit(minutes, 'min')}`
}
