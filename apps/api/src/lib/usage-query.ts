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
