import { z } from 'zod'

/**
 * Earliest timestamp the usage endpoints will surface. Rows before this
 * instant exist in argo.usage_record but never reach a chart — they predate
 * the project-normalize + workspace-classification cleanup that landed on
 * 2026-05-28 (collectors at usage-tracker 3bcc107 ~10:21 UTC, argo ingest at
 * 48ba358 ~10:22 UTC) and carry stale labels we don't want to backfill.
 * Buffered to 11:00 UTC to cover the next 15-min collector sync. Bump this
 * when a future data-quality reset lands.
 */
export const USAGE_DATA_FLOOR_ISO = '2026-05-28T11:00:00Z'

export const RangeEnum = z.enum(['7d', '30d', '90d', 'all'])
export const GrainEnum = z.enum(['day', 'week'])
export const MetricEnum = z.enum(['cost', 'tokens', 'errors', 'latency_p95', 'cache_ratio'])
export const TimeseriesGroupByEnum = z.enum([
  'source',
  'machine',
  'model_norm',
  'sub_tool',
  'project',
  'workspace',
  'billing',
  'outcome',
  'none',
])
export const BreakdownMetricEnum = z.enum(['cost', 'tokens', 'errors'])
export const BreakdownDimensionEnum = z.enum([
  'project',
  'workspace',
  'model_norm',
  'billing',
  'outcome',
  'source',
  'machine',
  'sub_tool',
])
export const WorkspaceEnum = z.enum(['work', 'private'])

/**
 * Normalize an optional query value to an array.
 *
 * Eden/URLSearchParams serialise a single-element array as a scalar
 * (`billing=max`); the `@elysiajs/openapi` validator runs against the
 * converted JSON Schema, not Zod's runtime, so `z.preprocess` never fires.
 * Handlers call this on the raw `query.foo` value before passing to SQL.
 */
export function toArray<T>(v: T | T[] | undefined): T[] | undefined {
  if (v === undefined) return undefined
  return Array.isArray(v) ? v : [v]
}

export function resolveRange(range: '7d' | '30d' | '90d' | 'all'): {
  fromIso: string
  toIso: string
} {
  const now = new Date()
  const toIso = now.toISOString()
  const floor = USAGE_DATA_FLOOR_ISO
  if (range === 'all') {
    return { fromIso: floor, toIso }
  }
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const from = new Date(now.getTime() - days * 86_400_000).toISOString()
  return { fromIso: from < floor ? floor : from, toIso }
}
