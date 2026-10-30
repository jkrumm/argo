import { log } from '../telemetry.js'

export interface AiUsageData {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  /** Cached portion of `prompt_tokens` (`prompt_tokens_details.cached_tokens`), when the upstream reports it. */
  cached_tokens?: number
  /** `completion_tokens_details.reasoning_tokens`, when the upstream reports it. */
  reasoning_tokens?: number
  /** `usage.cost` (USD), when the upstream reports it. Requesty-routed models do; IU's Bedrock/LiteLLM routes do not. */
  cost?: number
}

/** The two outcomes of an upstream call. */
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
  /** Request outcome. Defaults to `'ok'` when omitted — pass `'error'` on a failed upstream call. */
  outcome?: UsageOutcome
}

export type RecordUsageFn = (params: RecordUsageParams) => Promise<void>

/**
 * Argo's own AI calls are a handful of verdict sentences a day. They are not written to the `usage`
 * schema (Argo only reads it; usage-tracker and agw own the writes): the structured log line carries
 * the tokens for ClickStack, and the IU portal reconciliation holds the spend.
 */
export async function recordAiUsage(params: RecordUsageParams): Promise<void> {
  log.info('argo ai usage', {
    model: params.model,
    ...(params.subTool !== undefined ? { sub_tool: params.subTool } : {}),
    outcome: params.outcome ?? 'ok',
    started_at: params.startedAt,
    duration_ms: params.durationMs,
    prompt_tokens: params.usage.prompt_tokens,
    completion_tokens: params.usage.completion_tokens,
    cached_tokens: params.usage.cached_tokens ?? 0,
    reasoning_tokens: params.usage.reasoning_tokens ?? 0,
    ...(params.usage.cost !== undefined ? { cost_usd: params.usage.cost } : {}),
  })
}
