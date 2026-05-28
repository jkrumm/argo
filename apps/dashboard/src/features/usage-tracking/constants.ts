import { VX } from '@argo/charts'
import type { BillingValue, WorkspaceValue } from './types'

const SOURCE_KEY_TO_TOKEN: Record<string, keyof typeof VX.series.usageSource> = {
  'claude-code': 'claudeCode',
  claudeCode: 'claudeCode',
  litellm: 'litellm',
  'litellm-bridge': 'litellm',
  sideclaw: 'sideclaw',
  hermes: 'hermesAgent',
  'hermes-agent': 'hermesAgent',
  hermesAgent: 'hermesAgent',
  audio: 'audioProxy',
  'audio-proxy': 'audioProxy',
  audioProxy: 'audioProxy',
  feuer: 'feuer',
  opencode: 'opencode',
}

export function colorForSource(source: string): string {
  const token = SOURCE_KEY_TO_TOKEN[source]
  if (token !== undefined) return VX.series.usageSource[token]
  return VX.series.usageSource.other
}

export function colorForBilling(billing: string): string {
  if (billing === 'max') return VX.series.usageBilling.max
  if (billing === 'iu') return VX.series.usageBilling.iu
  return VX.series.usageBilling.unknown
}

export function colorForOutcome(outcome: string): string {
  if (outcome === 'ok') return VX.series.usageOutcome.ok
  if (outcome === 'error') return VX.series.usageOutcome.error
  if (outcome === 'cancelled') return VX.series.usageOutcome.cancelled
  return VX.series.usageSource.other
}

// Deterministic fallback color picker for unknown grouping keys (e.g. machines,
// projects, models) — cycles through a small VX.series palette so identical keys
// render with the same color across rerenders.
const FALLBACK_PALETTE = [
  VX.series.usageSource.claudeCode,
  VX.series.usageSource.litellm,
  VX.series.usageSource.sideclaw,
  VX.series.usageSource.hermesAgent,
  VX.series.usageSource.audioProxy,
  VX.series.usageSource.feuer,
  VX.series.usageSource.opencode,
  VX.series.usageSource.other,
]

function hashKey(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function colorForKey(key: string): string {
  return FALLBACK_PALETTE[hashKey(key) % FALLBACK_PALETTE.length] ?? VX.series.usageSource.other
}

export const ALL_BILLING: BillingValue[] = ['max', 'iu', 'unknown']
export const ALL_WORKSPACES: WorkspaceValue[] = ['work', 'private']

export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  if (Math.abs(n) >= 1000) return `$${n.toFixed(0)}`
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`
  if (n === 0) return '$0'
  return `$${n.toFixed(4)}`
}

export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`
  return n.toFixed(0)
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}

export function fmtMs(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`
  return `${n.toFixed(0)}ms`
}

export function relativeTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}
