import { db } from '../db/index.js'
import { usageRecord } from '../db/schema.js'
import { log } from '../telemetry.js'

export interface AiUsageData {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

/** Matches the domain accepted by the ingest side (`routes/usage.ts`'s `BillingEnum`). */
export type UsageBilling = 'max' | 'iu' | 'unknown'

/** Matches `usage_record.outcome`'s two known values (see `db/schema.ts`). */
export type UsageOutcome = 'ok' | 'error'

export interface RecordUsageParams {
  /** Raw model string from the upstream response. */
  model: string
  usage: AiUsageData
  /** Caller-supplied label: 'titling' | 'summarization' | etc. */
  subTool?: string
  /** ISO 8601 timestamp when the request was sent. */
  startedAt: string
  /** Wall-clock latency of the upstream call in ms. */
  durationMs: number
  /** Who pays for the call. Defaults to `'iu'` (IU unified endpoint) when omitted. */
  billing?: UsageBilling
  /** Request outcome. Defaults to `'ok'` when omitted — pass `'error'` on a failed upstream call. */
  outcome?: UsageOutcome
}

export type RecordUsageFn = (params: RecordUsageParams) => Promise<void>

// DeepSeek rates USD per 1M tokens.
// usage-tracker/src/pricing.ts is the authoritative source — keep in sync when rates change.
const DEEPSEEK_RATES: Record<string, { input: number; output: number }> = {
  'deepseek-v4-flash': { input: 0.14, output: 0.28 },
  'deepseek-v4-pro': { input: 0.435, output: 0.87 },
  // OpenAI list price, short context (<=272k); Azure OpenAI matches exactly.
  // Corrected 2026-08-20 from the OpenRouter reference figure ($0.10/$0.60), which
  // was wrong — OpenAI cut this model 80% on 2026-07-30 and $0.20/$1.20 is the
  // post-cut rate; $0.10/$0.60 is the *batch* tier (50% off), not a later cut —
  // do not "correct" these down to it. Still not confirmed as IU's actual billed
  // rate: IU no longer returns a `cost` field on any route.
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
}

/**
 * Reduce a raw DeepSeek model string to the canonical usage-tracker key.
 * Mirrors the normalizeModel() logic in usage-tracker/src/models.ts.
 */
export function normalizeDeepseekModel(raw: string): string {
  let m = raw.toLowerCase().trim()
  if (m.includes('/')) m = m.split('/').pop() ?? m
  return m.replace(/-eu$/, '').replace(/-\d{8}$/, '')
}

function computeCost(
  modelNorm: string,
  promptTokens: number,
  completionTokens: number,
): { cost_usd: number | null; cost_source: string } {
  const rates = DEEPSEEK_RATES[modelNorm]
  if (!rates) {
    // Audio models (gemini*tts, gpt-4o*-transcribe) are billed per audio-second /
    // character upstream, not per token, so they intentionally have no token rate
    // here — record the row with a null cost and don't warn (would spam per chunk).
    if (modelNorm.startsWith('deepseek')) {
      log.warn('unknown deepseek model norm — cannot compute cost', { modelNorm })
    }
    return { cost_usd: null, cost_source: 'none' }
  }
  return {
    cost_usd: (promptTokens * rates.input + completionTokens * rates.output) / 1_000_000,
    cost_source: 'computed',
  }
}

/**
 * Insert one row into argo.usage_record for an in-process Argo AI call.
 * Tagged source='argo'. `billing` defaults to 'iu' (IU unified endpoint,
 * EU-resident) and `outcome` defaults to 'ok' when the caller omits them.
 * DB errors are logged AND re-thrown, so callers must `catch()`.
 */
export async function recordAiUsage(params: RecordUsageParams): Promise<void> {
  const modelNorm = normalizeDeepseekModel(params.model)
  const { cost_usd, cost_source } = computeCost(
    modelNorm,
    params.usage.prompt_tokens,
    params.usage.completion_tokens,
  )
  const now = new Date().toISOString()
  try {
    await db.insert(usageRecord).values({
      source: 'argo',
      source_id: crypto.randomUUID(),
      grain: 'message',
      ts: params.startedAt,
      model: params.model,
      model_norm: modelNorm,
      project: 'argo',
      workspace: 'private',
      sub_tool: params.subTool ?? null,
      billing: params.billing ?? 'iu',
      machine: null,
      outcome: params.outcome ?? 'ok',
      input_tokens: params.usage.prompt_tokens,
      output_tokens: params.usage.completion_tokens,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      duration_ms: params.durationMs,
      cost_usd,
      cost_source,
      raw: null,
      ingested_at: now,
    })
  } catch (err) {
    log.error('failed to record argo ai usage', err)
    throw err
  }
}
