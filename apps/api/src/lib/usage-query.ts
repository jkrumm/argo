import { sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'

/**
 * Earliest timestamp the usage endpoints will surface. Rows before this
 * instant exist in `usage.records` but never reach a chart — they predate
 * the project-normalize + workspace-classification cleanup that landed on
 * 2026-05-28 (collectors at usage-tracker 3bcc107 ~10:21 UTC, argo ingest at
 * 48ba358 ~10:22 UTC) and carry stale labels we don't want to backfill.
 * Buffered to 11:00 UTC to cover the next 15-min collector sync. Bump this
 * when a future data-quality reset lands.
 */
export const USAGE_DATA_FLOOR_ISO = '2026-05-28T11:00:00Z'

export const RangeEnum = z.enum(['7d', '30d', '90d', 'all'])
export const GrainEnum = z.enum(['hour', 'day', 'week'])
export const MetricEnum = z.enum([
  'cost',
  'tokens',
  'tokens_input',
  'tokens_output',
  'tokens_cache_read',
  'tokens_cache_write',
  'errors',
  'error_rate',
  'latency_p95',
  'cache_ratio',
])
export const TimeseriesGroupByEnum = z.enum([
  'source',
  'machine',
  'model_norm',
  'sub_tool',
  'project',
  'workspace',
  'billing',
  'account',
  'iu_key',
  'payer',
  'outcome',
  'none',
])
export const BreakdownMetricEnum = z.enum(['cost', 'tokens', 'errors'])
export const BreakdownDimensionEnum = z.enum([
  'project',
  'workspace',
  'model_norm',
  'billing',
  'account',
  'iu_key',
  'payer',
  'outcome',
  'source',
  'machine',
  'sub_tool',
])
/** Claude account id as usage-tracker's registry spells it (`iu`, `me`, …). */
export const ACCOUNT_PATTERN = /^[a-z][a-z0-9-]{0,15}$/

/**
 * Who pays for a row, derived from (billing, account) at query time so it works on all history and
 * needs no column: `iu-sub` / `me-sub` / `me2-sub` are the Max subscriptions, `iu-api` the IU metered API
 * on the personal key, `iu-team-api` the same API on the Athena team key (billing + `iu_key`), `me-api` the
 * personal pay-per-token API (OpenRouter today), `unknown` anything else (including Max rows whose account
 * is not yet known and IU rows whose key is unknown).
 */
export const PAYERS = [
  'iu-sub',
  'me-sub',
  'me2-sub',
  'iu-api',
  'iu-team-api',
  'me-api',
  'unknown',
] as const

/** Payers that are metered API spend (real dollars, not Max list value); the "API spend" default set. */
export const API_PAYERS = ['iu-api', 'iu-team-api', 'me-api'] as const
export const PayerEnum = z.enum(PAYERS)

/** The payer of a `usage_record` row as one SQL expression; keep in step with `PAYERS`. */
export const PAYER_EXPR = sql.raw(`(CASE
  WHEN billing = 'max' AND account = 'iu' THEN 'iu-sub'
  WHEN billing = 'max' AND account = 'me' THEN 'me-sub'
  WHEN billing = 'max' AND account = 'me2' THEN 'me2-sub'
  WHEN billing = 'iu' AND iu_key = 'personal' THEN 'iu-api'
  WHEN billing = 'iu' AND iu_key = 'athena-team' THEN 'iu-team-api'
  WHEN billing = 'openrouter' THEN 'me-api'
  ELSE 'unknown'
END)`)

/**
 * Start of the UTC `day`/`week` that `instant` (a timestamptz expression) falls in. Pinned to UTC so a
 * bucket never depends on the database session's timezone (prod is `Etc/UTC` anyway).
 */
export const utcBucket = (grain: string, instant: SQL): SQL =>
  sql`date_trunc(${grain}, ${instant} AT TIME ZONE 'UTC')`

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
