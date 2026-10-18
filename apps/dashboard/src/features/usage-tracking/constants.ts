import type { StackedAreaBand } from 'basalt-ui/charts'
import { USAGE_BILLING, USAGE_SOURCE } from '../../lib/series'
import type { CostGroupBy, TimePoint } from './types'

const SOURCE_KEY_TO_TOKEN: Record<string, keyof typeof USAGE_SOURCE> = {
  'claude-code': 'claudeCode',
  claudeCode: 'claudeCode',
  litellm: 'litellm',
  'litellm-bridge': 'litellm',
  'agent-gateway': 'agentGateway',
  'agent-gateway-iu': 'agentGateway',
  'research-gateway': 'researchGateway',
  // Persisted source value: the service is image-gateway now, rows keep the old name.
  'image-gen-gateway': 'imageGen',
  'image-gateway': 'imageGen',
  'email-gateway': 'emailGateway',
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

function colorForSource(source: string): string {
  const token = SOURCE_KEY_TO_TOKEN[source]
  if (token !== undefined) return USAGE_SOURCE[token]
  return USAGE_SOURCE.other
}

function colorForBilling(billing: string): string {
  if (billing === 'max') return USAGE_BILLING.max
  if (billing === 'iu') return USAGE_BILLING.iu
  if (billing === 'openrouter') return USAGE_BILLING.openrouter
  return USAGE_BILLING.unknown
}

// Deterministic fallback color picker for unknown grouping keys (e.g. machines,
// projects, models) — cycles through a small USAGE_SOURCE palette so identical keys
// render with the same color across rerenders.
const FALLBACK_PALETTE = [
  USAGE_SOURCE.claudeCode,
  USAGE_SOURCE.litellm,
  USAGE_SOURCE.agentGateway,
  USAGE_SOURCE.hermesAgent,
  USAGE_SOURCE.audioProxy,
  USAGE_SOURCE.feuer,
  USAGE_SOURCE.opencode,
]

/**
 * Rank-assigned hues for the named series of a stacked chart: eight different hue families (sky, gold,
 * forest, red, orange, violet, turquoise, indigo). Cerulean is deliberately absent: next to sky it differs only in shade.
 */
export const RANK_PALETTE = [
  USAGE_SOURCE.claudeCode,
  USAGE_SOURCE.agentGateway,
  USAGE_SOURCE.audioProxy,
  USAGE_SOURCE.hermesAgent,
  USAGE_SOURCE.opencode,
  USAGE_SOURCE.researchGateway,
  USAGE_SOURCE.imageGen,
  USAGE_SOURCE.emailGateway,
]

function hashKey(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return Math.abs(h)
}

function colorForKey(key: string): string {
  return FALLBACK_PALETTE[hashKey(key) % FALLBACK_PALETTE.length] ?? USAGE_SOURCE.other
}

// Day buckets arrive as `YYYY-MM-DD` text; a bare date parses as UTC midnight, which labels the
// bucket a day early west of UTC. Parse as local midnight, once per bucket.
export function dayToDate(day: string): Date {
  return new Date(`${day}T00:00:00`)
}

export function toTimePoints(
  buckets: ReadonlyArray<{ bucket: string; groups: Record<string, number | null> }>,
): TimePoint[] {
  return buckets.map((b) => ({ date: dayToDate(b.bucket), groups: b.groups }))
}

export function colorForGroup(
  groupBy: CostGroupBy | 'sub_tool' | 'model_norm' | 'project',
): (key: string) => string {
  if (groupBy === 'source') return colorForSource
  if (groupBy === 'billing') return colorForBilling
  return colorForKey
}

// One band per group key, coloured by `color`; a missing bucket value stacks as 0.
export function groupBands(
  groupKeys: readonly string[],
  color: (key: string) => string,
  label: (key: string) => string = (k) => k,
  formatValue?: (v: number) => string,
): StackedAreaBand<TimePoint>[] {
  return groupKeys.map((k) => ({
    key: k,
    label: label(k),
    color: color(k),
    getValue: (d) => d.groups[k] ?? 0,
    ...(formatValue ? { formatValue } : {}),
  }))
}
