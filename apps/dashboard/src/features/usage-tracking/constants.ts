import type { StackedAreaBand } from 'basalt-ui/charts'
import { USAGE_PAYER, USAGE_RANK, USAGE_SOURCE } from '../../lib/series'
import { USAGE_PAYERS } from './accounts'
import type { TimePoint } from './types'

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

export function colorForSource(source: string): string {
  const token = SOURCE_KEY_TO_TOKEN[source]
  if (token !== undefined) return USAGE_SOURCE[token]
  return USAGE_SOURCE.other
}

export function colorForPayer(payer: string): string {
  const token = USAGE_PAYERS.find((p) => p.id === payer)?.token ?? 'unknown'
  return USAGE_PAYER[token] ?? USAGE_SOURCE.other
}

/**
 * Rank-assigned hues for the named series of a stacked chart: six hue families (sky, violet,
 * turquoise, indigo, rose, sepia), none of them a status ink. Amber, red and green stay with warn,
 * error and ok; cerulean is absent because next to sky it differs only in shade.
 */
export const RANK_PALETTE = [
  USAGE_RANK.sky,
  USAGE_RANK.violet,
  USAGE_RANK.turquoise,
  USAGE_RANK.indigo,
  USAGE_RANK.rose,
  USAGE_RANK.sepia,
]

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
