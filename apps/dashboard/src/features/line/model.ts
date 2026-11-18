import { formatDuration, NBSP } from '../../lib/format'
import type { LineWindow } from '../../lib/queries/line'

/** What each window reads as in a card qualifier. */
export const WINDOW_NOUN: Record<LineWindow, string> = {
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
}

export const TARGET_LABEL: Record<string, string> = {
  gateway: 'Router',
  cloudflare: 'Cloudflare',
  google: 'Google',
  quad9: 'Quad9',
}

export const targetLabel = (target: string): string => TARGET_LABEL[target] ?? target

/** A loss percentage as the page prints it: two decimals, never a rounded-away zero for a real loss. */
export function formatLoss(pct: number | null): string {
  if (pct === null) return '—'
  if (pct === 0) return '0'
  return pct < 0.01 ? '<0.01' : pct.toFixed(2)
}

export function formatUptime(pct: number): string {
  if (pct >= 100) return '100'
  // Never round 99.996 up to a "100" that hides a real outage.
  return (Math.floor(pct * 100) / 100).toFixed(2)
}

export const formatMs = (v: number | null): string => (v === null ? '—' : v.toFixed(v < 10 ? 1 : 0))
export const formatMbit = (v: number | null): string => (v === null ? '—' : String(Math.round(v)))
export const formatDb = (v: number | null): string => (v === null ? '—' : v.toFixed(1))

/** Seconds as the page's one duration spelling (`7 min`, `1 h 5 min`); an outage is never shorter than 30 s. */
export const durationText = (seconds: number): string => formatDuration(seconds * 1000)

export type OutageSpan = { start: number; end: number; ongoing: boolean }
export type ZoneMs = { from: number; to: number; fill: string }

/**
 * The outages as x zones in epoch ms. A 30 s outage on a 90-day axis is under a pixel, so every zone is
 * at least `minShare` of the axis wide, centred on the outage: a short outage stays visible and is
 * never drawn longer than it looks.
 */
export function outageZones(
  outages: readonly OutageSpan[],
  fromSec: number,
  toSec: number,
  fill: string,
  minShare = 0.004,
): ZoneMs[] {
  const minWidth = (toSec - fromSec) * minShare
  return outages.map((o) => {
    const width = o.end - o.start
    const pad = width < minWidth ? (minWidth - width) / 2 : 0
    return {
      from: Math.max(fromSec, o.start - pad) * 1000,
      to: Math.min(toSec, o.end + pad) * 1000,
      fill,
    }
  })
}

export type Verdict = { word: string; tone: 'bad' | 'warn' | undefined; phrase: string }

/** One word for the Now cell. Up is the quiet default (no tone); only down and unknown carry colour. */
export function verdict(
  state: 'up' | 'down' | 'stale',
  probeAtSec: number | null,
  ongoingSinceSec: number | null,
  nowMs: number,
): Verdict {
  if (state === 'down') {
    const since =
      ongoingSinceSec === null
        ? ''
        : `down for${NBSP}${formatDuration(nowMs - ongoingSinceSec * 1000)}`
    return { word: 'Down', tone: 'bad', phrase: since }
  }
  if (state === 'stale') {
    const ago =
      probeAtSec === null
        ? 'no sample yet'
        : `last sample ${formatDuration(nowMs - probeAtSec * 1000)} ago`
    return { word: 'No data', tone: 'warn', phrase: ago }
  }
  const age =
    probeAtSec === null
      ? ''
      : `checked ${formatDuration(Math.max(0, nowMs - probeAtSec * 1000))} ago`
  return { word: 'Up', tone: undefined, phrase: age }
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

/** The x axis label for a bucket start: a time of day for 24 h, a date otherwise. */
export function axisLabel(ms: number, window: LineWindow): string {
  const d = new Date(ms)
  if (window === '24h') return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** The tooltip header: the bucket's date, with its hour for every window under a day-wide bucket. */
export function bucketLabel(ms: number, window: LineWindow): string {
  const d = new Date(ms)
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  if (window === '90d') return day
  return `${day}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}
