import { formatDuration, NBSP } from '../../lib/format'
import type { Machine, MachineRange } from '../../lib/queries/machines'

/** What each range reads as in a card qualifier. */
export const RANGE_NOUN: Record<MachineRange, string> = {
  '1h': 'last hour',
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
}

export type Tone = 'warn' | 'bad'
type Limits = { warn: number; bad: number }

/** Colour only, nothing alerts: the line where a value starts to need the eye. Alerts live in ClickStack. */
export const LIMITS = {
  cpu: { warn: 90, bad: 98 },
  memory: { warn: 85, bad: 95 },
  disk: { warn: 80, bad: 90 },
  /** 1-minute load divided by the core count. */
  load: { warn: 1.5, bad: 2.5 },
} as const satisfies Record<string, Limits>

export function toneOf(value: number | null, limits: Limits): Tone | undefined {
  if (value === null) return undefined
  if (value >= limits.bad) return 'bad'
  if (value >= limits.warn) return 'warn'
  return undefined
}

/** Load as a share of the core count, or null without both. */
export function loadPerCore(load1: number | null, cores: number | null): number | null {
  return load1 === null || cores === null || cores <= 0 ? null : load1 / cores
}

const TONE_RANK: Record<Tone, number> = { warn: 1, bad: 2 }

/** 0 quiet, 1 warning, 2 bad, 3 silent: what the eye should land on first. */
export function attention(m: Machine): number {
  if (m.state === 'silent') return 3
  const tones = [
    toneOf(m.cpuPct, LIMITS.cpu),
    toneOf(m.memPct, LIMITS.memory),
    toneOf(m.fullestFilesystem?.pct ?? null, LIMITS.disk),
    toneOf(loadPerCore(m.load1, m.cores), LIMITS.load),
  ]
  return Math.max(0, ...tones.map((t) => (t === undefined ? 0 : TONE_RANK[t])))
}

/** The machine whose charts show: the picked one if it is listed, else the first that most needs attention. */
export function selectHost(machines: readonly Machine[], picked: string): string | undefined {
  if (machines.some((m) => m.host === picked)) return picked
  let best: Machine | undefined
  for (const m of machines) if (best === undefined || attention(m) > attention(best)) best = m
  return best?.host
}

const UNITS = ['B/s', 'kB/s', 'MB/s', 'GB/s'] as const

/** Bytes per second with one unit of 1000: `340 kB/s`, `1.2 MB/s`. */
export function formatRate(bps: number | null): string {
  if (bps === null) return '—'
  let value = bps
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit++
  }
  const text =
    value >= 100 || unit === 0 ? String(Math.round(value)) : value.toFixed(value >= 10 ? 0 : 1)
  return `${text}${NBSP}${UNITS[unit]}`
}

/** Memory of a container: `340 MiB`, `1.2 GiB`. */
export function formatMemory(bytes: number | null): string {
  if (bytes === null) return '—'
  const mib = bytes / 1_048_576
  if (mib < 1024) return `${Math.round(mib)}${NBSP}MiB`
  return `${(mib / 1024).toFixed(1)}${NBSP}GiB`
}

export const formatPct = (v: number | null): string => (v === null ? '—' : String(Math.round(v)))

export const formatLoad = (v: number | null): string =>
  v === null ? '—' : v.toFixed(v < 10 ? 1 : 0)

/** Share of the range a machine reported: never rounded up to a 100 that hides a gap. */
export function formatReporting(pct: number | null): string {
  if (pct === null) return '—'
  if (pct >= 100) return '100'
  return (Math.floor(pct * 10) / 10).toFixed(1)
}

/** The sub-line under a machine's name. */
export function statusLine(m: Machine, range: MachineRange, nowMs: number): string {
  const reporting =
    m.reportingPct === null
      ? ''
      : `${NBSP}·${NBSP}${formatReporting(m.reportingPct)}${NBSP}% reporting${NBSP}·${NBSP}${range}`
  if (m.state === 'silent')
    return `silent${NBSP}·${NBSP}last seen ${formatDuration(nowMs - m.lastSeen * 1000)} ago${reporting}`
  return reporting === '' ? 'reporting' : reporting.slice(NBSP.length + 1 + NBSP.length)
}

export type ZoneMs = { from: Date; to: Date; fill: string }

/** Silent stretches as x zones, at least `minShare` of the axis wide so a 10 minute gap on 30 days stays visible. */
export function gapZones(
  gaps: readonly { from: number; to: number }[],
  fromSec: number,
  toSec: number,
  fill: string,
  minShare = 0.004,
): ZoneMs[] {
  const minWidth = (toSec - fromSec) * minShare
  return gaps.map((g) => {
    const width = g.to - g.from
    const pad = width < minWidth ? (minWidth - width) / 2 : 0
    return {
      from: new Date(Math.max(fromSec, g.from - pad) * 1000),
      to: new Date(Math.min(toSec, g.to + pad) * 1000),
      fill,
    }
  })
}
