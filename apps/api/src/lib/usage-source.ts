import { sql } from 'drizzle-orm'

/**
 * The usage pages' one read model: `usage.records_unique` (owned by usage-tracker, schema v2, see
 * usage-tracker/docs/usage-schema.md) projected onto the column names the queries and the dashboard
 * already speak. Every usage query selects `FROM ${USAGE_ROWS}`; none touches `usage.records` itself,
 * because `records_unique` leaves out the marked gateway duplicates.
 *
 * Mapping from the v2 columns:
 * - `model_norm` = `model`, `model` = `model_raw`
 * - `project` = `repo` without the `iu/` namespace prefix (the pages never split by namespace; `workspace` carries
 *   work vs private), else a bare name in `project_raw` (`hermes-agent`, `audio-gateway`: real
 *   SourceRoot names the repo normaliser leaves NULL), else NULL; a path never leaks through
 * - `sub_tool` = the lane's tool label: workflow (+ `:step`) for `agw_workflow`, the subagent type, the
 *   raw collector string for `other`, otherwise the lane itself
 * - `billing` = `api_key` rows are the IU metered API (`iu`) when they carry an IU key, `openrouter`
 *   (personal pay-per-token) when they do not; `max` and `unknown` as stored
 * - `iu_key` = `api_key` on IU rows only
 * - `cache_write_tokens` = the 5 min and 1 h writes summed (the dashboard shows one write figure)
 * - `cost_usd` as float8 (the column is numeric; the queries sum and `Number()` it)
 */
export const USAGE_ROWS = sql.raw(`(
  SELECT
    r.source,
    r.source_id,
    r.grain,
    r.ts,
    r.model_raw AS model,
    r.model AS model_norm,
    COALESCE(regexp_replace(r.repo, '^iu/', ''), CASE WHEN r.project_raw ~ '^[^/]+$' THEN r.project_raw END) AS project,
    r.workspace,
    (CASE
      WHEN r.lane = 'agw_workflow'
        THEN COALESCE(NULLIF(concat_ws(':', r.lane_detail->>'workflow', r.lane_detail->>'step'), ''), r.lane)
      WHEN r.lane = 'subagent' THEN COALESCE(r.lane_detail->>'subagent_type', r.lane)
      WHEN r.lane = 'other' THEN COALESCE(r.lane_detail->>'raw', r.lane)
      ELSE r.lane
    END) AS sub_tool,
    (CASE
      WHEN r.billing = 'api_key' AND r.api_key IS NOT NULL THEN 'iu'
      WHEN r.billing = 'api_key' THEN 'openrouter'
      ELSE r.billing
    END) AS billing,
    r.account,
    (CASE WHEN r.billing = 'api_key' THEN r.api_key END) AS iu_key,
    r.machine,
    r.outcome,
    r.input_tokens,
    r.output_tokens,
    r.cache_read_tokens,
    (r.cache_write_5m_tokens + r.cache_write_1h_tokens) AS cache_write_tokens,
    r.reasoning_tokens,
    r.duration_ms,
    r.cost_usd::float8 AS cost_usd,
    r.cost_source
  FROM usage.records_unique r
) AS usage_record`)
