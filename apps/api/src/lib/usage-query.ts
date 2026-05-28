import { z } from 'zod'

export const RangeEnum = z.enum(['7d', '30d', '90d', 'all'])
export const GrainEnum = z.enum(['day', 'week'])
export const MetricEnum = z.enum(['cost', 'tokens', 'errors', 'latency_p95', 'cache_ratio'])
export const TimeseriesGroupByEnum = z.enum([
  'source',
  'machine',
  'model_norm',
  'sub_tool',
  'project',
  'billing',
  'outcome',
  'none',
])
export const BreakdownMetricEnum = z.enum(['cost', 'tokens', 'errors'])
export const BreakdownDimensionEnum = z.enum([
  'project',
  'model_norm',
  'billing',
  'outcome',
  'source',
  'machine',
  'sub_tool',
])

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
  fromIso: string | null
  toIso: string
} {
  const now = new Date()
  const toIso = now.toISOString()
  if (range === 'all') {
    return { fromIso: null, toIso }
  }
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const from = new Date(now.getTime() - days * 86_400_000)
  return { fromIso: from.toISOString(), toIso }
}
