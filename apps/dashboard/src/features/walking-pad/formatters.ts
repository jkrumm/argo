// Pure formatters for WalkingPad numbers. No deps on Mantine or charts.

import { km } from 'basalt-ui/format'

export function formatMeters(meters: number): string {
  if (meters >= 1000) return km(meters)
  return `${Math.round(meters)} m`
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0 && s > 0 && seconds < 600) return `${m}m ${s}s`
  return `${m}m`
}

export function formatPace(kmh: number, digits = 2): string {
  return `${kmh.toFixed(digits)} km/h`
}

export function formatDeltaKmh(delta: number, digits = 2): string {
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(digits)} km/h`
}

export function relativeTime(iso: string, now = new Date()): string {
  const t = new Date(iso).getTime()
  const diffS = Math.max(0, Math.round((now.getTime() - t) / 1000))
  if (diffS < 60) return `${diffS}s ago`
  if (diffS < 3600) return `${Math.round(diffS / 60)}m ago`
  if (diffS < 86_400) return `${Math.round(diffS / 3600)}h ago`
  return `${Math.round(diffS / 86_400)}d ago`
}
