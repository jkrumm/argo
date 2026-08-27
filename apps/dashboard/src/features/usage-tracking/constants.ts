import { USAGE_BILLING, USAGE_OUTCOME, USAGE_SOURCE } from '../../lib/series'

const SOURCE_KEY_TO_TOKEN: Record<string, keyof typeof USAGE_SOURCE> = {
  'claude-code': 'claudeCode',
  claudeCode: 'claudeCode',
  litellm: 'litellm',
  'litellm-bridge': 'litellm',
  sideclaw: 'sideclaw',
  'sideclaw-iu': 'sideclaw',
  'research-gateway': 'researchGateway',
  'image-gen-gateway': 'imageGen',
  hermes: 'hermesAgent',
  'hermes-agent': 'hermesAgent',
  hermesAgent: 'hermesAgent',
  audio: 'audioProxy',
  'audio-proxy': 'audioProxy',
  'audio-gateway': 'audioProxy',
  audioProxy: 'audioProxy',
  feuer: 'feuer',
  opencode: 'opencode',
}

export function colorForSource(source: string): string {
  const token = SOURCE_KEY_TO_TOKEN[source]
  if (token !== undefined) return USAGE_SOURCE[token]
  return USAGE_SOURCE.other
}

export function colorForBilling(billing: string): string {
  if (billing === 'max') return USAGE_BILLING.max
  if (billing === 'iu') return USAGE_BILLING.iu
  return USAGE_BILLING.unknown
}

export function colorForOutcome(outcome: string): string {
  if (outcome === 'ok') return USAGE_OUTCOME.ok
  if (outcome === 'error') return USAGE_OUTCOME.error
  if (outcome === 'cancelled') return USAGE_OUTCOME.cancelled
  return USAGE_SOURCE.other
}

// Deterministic fallback color picker for unknown grouping keys (e.g. machines,
// projects, models) — cycles through a small USAGE_SOURCE palette so identical keys
// render with the same color across rerenders.
const FALLBACK_PALETTE = [
  USAGE_SOURCE.claudeCode,
  USAGE_SOURCE.litellm,
  USAGE_SOURCE.sideclaw,
  USAGE_SOURCE.hermesAgent,
  USAGE_SOURCE.audioProxy,
  USAGE_SOURCE.feuer,
  USAGE_SOURCE.opencode,
  USAGE_SOURCE.other,
]

function hashKey(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function colorForKey(key: string): string {
  return FALLBACK_PALETTE[hashKey(key) % FALLBACK_PALETTE.length] ?? USAGE_SOURCE.other
}

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
