import { sql, type SQL } from 'drizzle-orm'
import { db } from '../db/index.js'

/**
 * Seeding for the usage route tests. The usage pages read schema `usage` (owned by usage-tracker, DDL
 * applied to the scratch database by scripts/test.sh); Argo's app role cannot write it, but the test
 * process is admin in its scratch database, so the fixtures are plain INSERTs.
 *
 * Records keep the shape the read model projects to (`USAGE_ROWS` in lib/usage-source.ts: source,
 * model, model_norm, project, sub_tool, billing 'max'|'iu'|'openrouter'|'unknown', iu_key,
 * cache_write_tokens), mapped back to `usage.records`:
 * - model -> model_raw, model_norm -> model, project -> repo (empty = NULL, as the repo normaliser
 *   leaves it) and project_raw
 * - sub_tool -> lane: a bare lane name stays itself, `a:b[:c]` is an agw_workflow (workflow `a`, step
 *   `b[:c]`), anything else is lane `other` with the string in lane_detail.raw; absent = `interactive`.
 *   (The projection cannot yield a NULL sub_tool.) `lane` / `lane_detail` override the mapping.
 * - billing iu -> api_key with api_key = iu_key, openrouter -> api_key with NULL api_key, api_credit stays itself
 * - cache_write_tokens -> cache_write_5m_tokens
 */

const LANES = [
  'interactive',
  'wave_mother',
  'lead',
  'worker',
  'fan_worker',
  'subagent',
  'hermes',
  'iris',
  'agw_workflow',
  'other',
]

export interface SeedRecord {
  source: string
  source_id: string
  /** Anything but 'session' is stored as 'message' (the v2 CHECK knows only those two). */
  grain?: string
  ts: string | Date
  model?: string | null
  model_norm?: string | null
  project?: string | null
  workspace?: 'work' | 'private' | null
  sub_tool?: string | null
  billing?: 'max' | 'iu' | 'openrouter' | 'api_credit' | 'unknown'
  account?: string | null
  iu_key?: string | null
  machine?: string | null
  outcome?: 'ok' | 'error'
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  cache_write_1h_tokens?: number
  reasoning_tokens?: number
  duration_ms?: number | null
  cost_usd?: number | null
  cost_source?: 'reported' | 'prices' | 'override' | 'none'
  raw?: unknown
  ingested_at?: string | Date
  /** Overrides for the stored v2 columns when the old shape cannot say it. */
  repo?: string | null
  project_raw?: string | null
  lane?: string
  lane_detail?: Record<string, unknown> | null
  /** The stored `run_id` column (agent-workflows rows keep their run here, not in lane_detail). */
  run_id?: string | null
  /** Source-local id of the `usage.sessions` row the record belongs to (created on first use, one per id). */
  session?: string | null
  /** The stored `issue_id` column (a bare factory issue number). */
  issue_id?: string | null
}

const iso = (v: string | Date) => (v instanceof Date ? v.toISOString() : v)
const json = (v: unknown): SQL => sql`${JSON.stringify(v)}::text::jsonb`

function laneOf(r: SeedRecord): { lane: string; detail: Record<string, unknown> | null } {
  if (r.lane) return { lane: r.lane, detail: r.lane_detail ?? null }
  const sub = r.sub_tool
  if (!sub) return { lane: 'interactive', detail: null }
  if (sub.includes(':')) {
    const [workflow, ...step] = sub.split(':')
    return { lane: 'agw_workflow', detail: { workflow, step: step.join(':') } }
  }
  if (LANES.includes(sub) && sub !== 'other') return { lane: sub, detail: null }
  return { lane: 'other', detail: { raw: sub } }
}

function ingestedAt(v: SeedRecord['ingested_at']): SQL {
  if (v === undefined) return sql`now()`
  const parsed = new Date(v)
  return Number.isNaN(parsed.getTime()) ? sql`now()` : sql`${parsed.toISOString()}::timestamptz`
}

/** Finds or creates the `usage.sessions` row `records.session_id` references; returns its id. */
async function ensureSession(
  source: string,
  sourceSessionId: string,
  lane: string,
): Promise<number> {
  const rows = (await db.execute(sql`
    INSERT INTO usage.sessions (source, source_session_id, lane)
    VALUES (${source}, ${sourceSessionId}, ${lane})
    ON CONFLICT (source, source_session_id) DO UPDATE SET lane = EXCLUDED.lane
    RETURNING id
  `)) as unknown as Array<{ id: number | string }>
  return Number(rows[0]?.id)
}

/** Inserts usage.records rows. Returns the generated ids in input order. */
export async function seedUsageRecords(records: SeedRecord | SeedRecord[]): Promise<number[]> {
  const ids: number[] = []
  for (const r of Array.isArray(records) ? records : [records]) {
    const { lane, detail } = laneOf(r)
    const billing = r.billing ?? 'unknown'
    const sessionId = r.session ? await ensureSession(r.source, r.session, lane) : null
    const apiKey = billing === 'iu' ? (r.iu_key ?? null) : null
    const rows = (await db.execute(sql`
      INSERT INTO usage.records (
        source, source_id, grain, ts, model_raw, model, repo, project_raw, workspace, billing, account,
        api_key, machine, outcome, lane, lane_detail, run_id, session_id, issue_id, input_tokens, output_tokens, cache_read_tokens,
        cache_write_5m_tokens, cache_write_1h_tokens, reasoning_tokens, duration_ms, cost_usd, cost_source,
        raw, ingested_at
      ) VALUES (
        ${r.source}, ${r.source_id}, ${r.grain === 'session' ? 'session' : 'message'}, ${iso(r.ts)}::timestamptz,
        ${r.model ?? null}, ${r.model_norm ?? null},
        ${r.repo !== undefined ? r.repo : r.project || null},
        ${r.project_raw !== undefined ? r.project_raw : (r.project ?? null)},
        ${r.workspace ?? null},
        ${billing === 'max' || billing === 'unknown' || billing === 'api_credit' ? billing : 'api_key'},
        ${r.account ?? null}, ${apiKey}, ${r.machine ?? null}, ${r.outcome ?? 'ok'},
        ${lane}, ${detail ? json(detail) : null}, ${r.run_id ?? null}, ${sessionId}, ${r.issue_id ?? null},
        ${r.input_tokens ?? 0}, ${r.output_tokens ?? 0}, ${r.cache_read_tokens ?? 0},
        ${r.cache_write_tokens ?? 0}, ${r.cache_write_1h_tokens ?? 0}, ${r.reasoning_tokens ?? 0},
        ${r.duration_ms ?? null}, ${r.cost_usd ?? null}, ${r.cost_source ?? 'none'},
        ${r.raw === undefined || r.raw === null ? null : json(r.raw)}, ${ingestedAt(r.ingested_at)}
      ) RETURNING id
    `)) as unknown as Array<{ id: number | string }>
    ids.push(Number(rows[0]?.id))
  }
  return ids
}

/** Marks `recordId` as the later copy of `duplicateOf` (what `usage.flag_gateway_duplicates()` does). */
export async function markUsageDuplicate(recordId: number, duplicateOf: number): Promise<void> {
  await db.execute(
    sql`INSERT INTO usage.record_duplicates (record_id, duplicate_of, rule) VALUES (${recordId}, ${duplicateOf}, 'test')`,
  )
}

export async function deleteUsageBySource(source: string): Promise<void> {
  await db.execute(sql`DELETE FROM usage.records WHERE source = ${source}`)
  await db.execute(sql`DELETE FROM usage.sessions WHERE source = ${source}`)
}

/** Empties usage.records (and, by cascade, record_duplicates). Scratch databases only. */
export async function deleteAllUsageRecords(): Promise<void> {
  await db.execute(sql`DELETE FROM usage.records`)
  await db.execute(sql`DELETE FROM usage.sessions`)
}

export interface SeedQuotaSample {
  account: string
  sampled_at: string | Date
  machine: string
  five_hour_pct?: number | null
  seven_day_pct?: number | null
  five_hour_resets_at?: string | Date | null
  seven_day_resets_at?: string | Date | null
  auth_ok?: boolean | null
  exhausted_until?: string | Date | null
  source?: string | null
}

const isoOrNull = (v: string | Date | null | undefined): string | null =>
  v === null || v === undefined ? null : iso(v)

export async function seedQuotaSamples(samples: SeedQuotaSample[]): Promise<void> {
  for (const s of samples) {
    await db.execute(sql`
      INSERT INTO usage.quota_samples (
        account, sampled_at, machine, five_hour_pct, seven_day_pct, five_hour_resets_at,
        seven_day_resets_at, auth_ok, exhausted_until, source
      ) VALUES (
        ${s.account}, ${iso(s.sampled_at)}::timestamptz, ${s.machine},
        ${s.five_hour_pct ?? null}, ${s.seven_day_pct ?? null},
        ${isoOrNull(s.five_hour_resets_at)}::timestamptz, ${isoOrNull(s.seven_day_resets_at)}::timestamptz,
        ${s.auth_ok ?? true}, ${isoOrNull(s.exhausted_until)}::timestamptz, ${s.source ?? null}
      )
    `)
  }
}

export async function deleteQuotaSamples(accounts: string[]): Promise<void> {
  if (accounts.length === 0) return
  await db.execute(
    sql`DELETE FROM usage.quota_samples WHERE account IN (${sql.join(
      accounts.map((a) => sql`${a}`),
      sql`, `,
    )})`,
  )
}

export interface SeedAccountPick {
  ts: string | Date
  lane: string
  picked: string
  reason: string
  stale?: boolean
  snapshot?: unknown
  machine: string
}

export async function seedAccountPicks(picks: SeedAccountPick[]): Promise<void> {
  for (const p of picks) {
    await db.execute(sql`
      INSERT INTO usage.account_picks (ts, lane, picked, reason, stale, snapshot, machine)
      VALUES (
        ${iso(p.ts)}::timestamptz, ${p.lane}, ${p.picked}, ${p.reason}, ${p.stale ?? false},
        ${p.snapshot === undefined ? null : json(p.snapshot)}, ${p.machine}
      )
    `)
  }
}

/** Deletes the picks whose lane starts with `lanePrefix`. */
export async function deleteAccountPicksByLane(lanePrefix: string): Promise<void> {
  await db.execute(sql`DELETE FROM usage.account_picks WHERE starts_with(lane, ${lanePrefix})`)
}

export interface SeedIuPortalCost {
  iu_key?: string
  day: string
  label: string
  row: number
  model?: string | null
  cost_usd: number
  fetched_at: string | Date
}

export interface SeedIuPortalTotal {
  iu_key?: string
  month: string
  total_usd: number
  fetched_at: string | Date
}

export async function seedIuPortal(report: {
  costs?: SeedIuPortalCost[]
  totals?: SeedIuPortalTotal[]
}): Promise<void> {
  for (const c of report.costs ?? []) {
    await db.execute(sql`
      INSERT INTO usage.iu_portal_cost (iu_key, day, label, "row", model, cost_usd, fetched_at)
      VALUES (${c.iu_key ?? 'personal'}, ${c.day}::date, ${c.label}, ${c.row}, ${c.model ?? null},
              ${c.cost_usd}, ${iso(c.fetched_at)}::timestamptz)
    `)
  }
  for (const t of report.totals ?? []) {
    await db.execute(sql`
      INSERT INTO usage.iu_portal_total (iu_key, month, total_usd, fetched_at)
      VALUES (${t.iu_key ?? 'personal'}, ${t.month}, ${t.total_usd}, ${iso(t.fetched_at)}::timestamptz)
    `)
  }
}

export async function deleteIuPortal(): Promise<void> {
  await db.execute(sql`DELETE FROM usage.iu_portal_cost`)
  await db.execute(sql`DELETE FROM usage.iu_portal_total`)
}

/** A gateway row (`source='gateway'`): billed to a credit pool (`api_credit` + account) or to IU (`api_key`). */
export interface SeedGatewayRow {
  /** Also the request id `gateway_picks` joins on. */
  id: string
  ts: string | Date
  /** Pool account for an `api_credit` row; absent = the IU passthrough (an `api_key` row). */
  account?: string
  iu_key?: string
  cost_usd?: number | null
  /** `lane_detail.purpose` */
  purpose?: string
  /** `lane_detail.costEstimatedUsd` */
  estimate?: number
  /** `lane_detail.routeFallback` */
  routeFallback?: string
}

export async function seedGatewayRows(rows: SeedGatewayRow[]): Promise<void> {
  for (const r of rows) {
    const detail = {
      caller: 'agw',
      ...(r.purpose === undefined ? {} : { purpose: r.purpose }),
      ...(r.estimate === undefined ? {} : { costEstimatedUsd: r.estimate }),
      ...(r.routeFallback === undefined ? {} : { routeFallback: r.routeFallback }),
    }
    const credit = r.account !== undefined
    await db.execute(sql`
      INSERT INTO usage.records (
        source, source_id, grain, ts, billing, account, api_key, machine, outcome, lane, lane_detail,
        input_tokens, output_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
        reasoning_tokens, cost_usd, cost_source
      ) VALUES (
        'gateway', ${r.id}, 'message', ${iso(r.ts)}::timestamptz,
        ${credit ? 'api_credit' : 'api_key'}, ${r.account ?? null}, ${credit ? null : (r.iu_key ?? 'personal')},
        'gateway-test', 'ok', 'other', ${json(detail)}, 0, 0, 0, 0, 0, 0,
        ${r.cost_usd === undefined ? null : r.cost_usd}, ${r.cost_usd == null ? 'none' : 'prices'}
      )
    `)
  }
}

export interface SeedCreditCycle {
  account: string
  cycle_start: string | Date
  cycle_end: string | Date | null
  grant_usd: number
  reconciled_usd?: number | null
  unspent_usd?: number | null
  closed_at?: string | Date | null
}

export async function seedCreditCycles(cycles: SeedCreditCycle[]): Promise<void> {
  for (const c of cycles) {
    await db.execute(sql`
      INSERT INTO usage.credit_cycles (account, cycle_start, cycle_end, grant_usd, metered_usd, reconciled_usd, unspent_usd, closed_at)
      VALUES (${c.account}, ${iso(c.cycle_start)}::timestamptz,
              ${c.cycle_end === null ? null : iso(c.cycle_end)}::timestamptz, ${c.grant_usd}, 0,
              ${c.reconciled_usd ?? null}, ${c.unspent_usd ?? null},
              ${c.closed_at == null ? null : iso(c.closed_at)}::timestamptz)
    `)
  }
}

export interface SeedPlatformCost {
  account: string
  day: string
  cost_usd: number
  refreshed_at: string | Date
}

export async function seedPlatformCost(rows: SeedPlatformCost[]): Promise<void> {
  for (const r of rows) {
    await db.execute(sql`
      INSERT INTO usage.platform_cost (account, day, model, api_key_id, cost_usd, refreshed_at)
      VALUES (${r.account}, ${r.day}::date, 'claude-test', 'key-test', ${r.cost_usd}, ${iso(r.refreshed_at)}::timestamptz)
    `)
  }
}

export interface SeedGatewayPick {
  ts: string | Date
  caller?: string
  session?: string | null
  /** A pool id, `iu-api` or `refused`. */
  picked: string
  reason: string
  /** Defaults to `gateway-test` (what `deleteCreditFixtures` clears); pass one to clean up by machine. */
  machine?: string
  /** The gateway row this pick served (its `source_id`). */
  request_id: string
}

export async function seedGatewayPicks(picks: SeedGatewayPick[]): Promise<void> {
  for (const p of picks) {
    await db.execute(sql`
      INSERT INTO usage.gateway_picks (ts, caller, session, picked, reason, machine, request_id)
      VALUES (${iso(p.ts)}::timestamptz, ${p.caller ?? 'agw'}, ${p.session === undefined ? 'session-test' : p.session},
              ${p.picked}, ${p.reason}, ${p.machine ?? 'gateway-test'}, ${p.request_id})
    `)
  }
}

/** Empties the credit tables the pace tests seed. Scratch databases only. */
export async function deleteCreditFixtures(): Promise<void> {
  await db.execute(sql`DELETE FROM usage.credit_cycles`)
  await db.execute(sql`DELETE FROM usage.platform_cost`)
  await db.execute(sql`DELETE FROM usage.gateway_picks`)
}

export async function deleteGatewayPicksByMachine(machine: string): Promise<void> {
  await db.execute(sql`DELETE FROM usage.gateway_picks WHERE machine = ${machine}`)
}
