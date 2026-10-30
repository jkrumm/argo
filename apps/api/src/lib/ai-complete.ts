import { tracedFetch, type TraceOptions } from './traced-fetch.js'
import { env } from '../env.js'
import { recordAiUsage, type RecordUsageFn } from './ai-usage.js'
import { log } from '../telemetry.js'

// `aiComplete()` is the in-process seam astro, marine and reading-match call: one non-streaming
// chat completion on the model named by DEEPSEEK_MODEL (IU unified endpoint, OpenAI transport).
// The upstream is reached via `tracedFetch` (OTel CLIENT spans).

/**
 * Minimal fetch shape (no `preconnect`) — matches `tracedFetch`, so the caller
 * and its tests share one transport type and a fake upstream is trivial to
 * inject. The optional third `traceOptions` param mirrors `tracedFetch`'s own
 * signature; a test stub that only declares `(input, init)` remains assignable.
 */
export type FetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
  traceOptions?: TraceOptions,
) => Promise<Response>

/** Injectable upstream config so tests can point at a fake endpoint. */
export interface AiCompleteDeps {
  /** Chat upstream base URL (IU unified endpoint, OpenAI transport), incl. `/v1`. */
  deepseekBaseURL: string
  deepseekApiKey: string
  deepseekModel: string
  /** Top-level `reasoning_effort` sent with every `aiComplete` call. */
  deepseekReasoningEffort: string
  /** Underlying transport the gateway wraps (defaults to the OTel-traced fetch). */
  fetchImpl: FetchImpl
  /**
   * Usage recorder called after each `aiComplete` call when the upstream returns
   * token counts. Defaults to `recordAiUsage` (a structured log line). Override in tests to
   * spy without touching the DB.
   */
  recordUsage: RecordUsageFn
}

function defaultDeps(): AiCompleteDeps {
  return {
    deepseekBaseURL: env.DEEPSEEK_BASE_URL,
    deepseekApiKey: env.DEEPSEEK_API_KEY,
    deepseekModel: env.DEEPSEEK_MODEL,
    deepseekReasoningEffort: env.DEEPSEEK_REASONING_EFFORT,
    fetchImpl: tracedFetch,
    recordUsage: recordAiUsage,
  }
}

/** Join a base URL (with or without trailing slash) and an absolute path. */
function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path
}

function bearer(key: string): Record<string, string> {
  return key ? { authorization: `Bearer ${key}` } : {}
}

/**
 * Default `max_completion_tokens` for callers that don't size their own
 * budget. `deepseekModel` is a reasoning model that spends this budget on
 * hidden reasoning before visible content — an under-budgeted call returns
 * HTTP 200 with empty content and `finish_reason: "length"`, not an error.
 * Unused budget is never billed, so this errs generous (>=16000, per the
 * reasoning-model floor).
 */
export const AI_DEFAULT_MAX_COMPLETION_TOKENS = 16000

/**
 * In-process helper: a single non-streaming chat completion returning the
 * assistant text. astro, marine and reading-match import this directly (no HTTP hop).
 * Token usage is logged fire-and-forget (`recordAiUsage`) when the upstream returns a usage object.
 *
 * `deepseekModel` is a reasoning model: an empty completion with
 * `finish_reason: "length"` means the budget was spent entirely on hidden
 * reasoning tokens, not a real failure. On empty content or `finish_reason:
 * "length"` this retries ONCE with a doubled `max_completion_tokens`, then
 * throws — callers that must never throw (e.g. `completeSentence`) wrap this
 * in their own try/catch. A discarded truncated/empty attempt is still billed
 * (the upstream call happened) but recorded with `outcome: 'error'`, never `'ok'`.
 */
export async function aiComplete(
  prompt: string,
  opts: {
    system?: string
    model?: string
    maxTokens?: number
    /** Usage-record sub_tool tag, e.g. 'titling' | 'summarization'. */
    sub_tool?: string
    deps?: Partial<AiCompleteDeps>
  } = {},
): Promise<string> {
  const deps = { ...defaultDeps(), ...opts.deps }
  if (!deps.deepseekBaseURL) throw new Error('AI gateway not configured (DEEPSEEK_BASE_URL unset)')

  const messages = [
    ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
    { role: 'user', content: prompt },
  ]
  const model = opts.model ?? deps.deepseekModel

  let maxTokens = opts.maxTokens ?? AI_DEFAULT_MAX_COMPLETION_TOKENS
  for (let attempt = 0; attempt < 2; attempt++) {
    const startedAt = new Date().toISOString()
    const startMs = Date.now()
    const res = await deps.fetchImpl(joinUrl(deps.deepseekBaseURL, '/chat/completions'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bearer(deps.deepseekApiKey) },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        reasoning_effort: deps.deepseekReasoningEffort,
        max_completion_tokens: maxTokens,
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      // The upstream call was attempted (and billed, if it partially ran) — record
      // an error-outcome row so `outcome` has a real denominator. Fire-and-forget
      // with its own `.catch()`: a DB failure here must never replace the real
      // upstream error the caller is about to throw.
      deps
        .recordUsage({
          model,
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          ...(opts.sub_tool !== undefined ? { subTool: opts.sub_tool } : {}),
          startedAt,
          durationMs: Date.now() - startMs,
          outcome: 'error',
        })
        .catch((err: unknown) => log.error('argo ai usage record failed (error path)', err))
      throw new Error(`AI completion failed: ${res.status} ${detail.slice(0, 200)}`)
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        total_tokens?: number
        prompt_tokens_details?: { cached_tokens?: number }
        completion_tokens_details?: { reasoning_tokens?: number }
        cost?: number
      }
      model?: string
    }
    const content = json.choices?.[0]?.message?.content ?? ''
    const finishReason = json.choices?.[0]?.finish_reason
    // A truncated/empty attempt is billed (the upstream call happened, and
    // ran a real reasoning budget) but discarded — never recorded as 'ok'.
    const discarded = content.trim().length === 0 || finishReason === 'length'

    if (json.usage?.prompt_tokens !== undefined) {
      deps
        .recordUsage({
          model: json.model ?? model,
          usage: {
            prompt_tokens: json.usage.prompt_tokens ?? 0,
            completion_tokens: json.usage.completion_tokens ?? 0,
            total_tokens: json.usage.total_tokens ?? 0,
            ...(json.usage.prompt_tokens_details?.cached_tokens !== undefined
              ? { cached_tokens: json.usage.prompt_tokens_details.cached_tokens }
              : {}),
            ...(json.usage.completion_tokens_details?.reasoning_tokens !== undefined
              ? { reasoning_tokens: json.usage.completion_tokens_details.reasoning_tokens }
              : {}),
            ...(json.usage.cost !== undefined ? { cost: json.usage.cost } : {}),
          },
          ...(opts.sub_tool !== undefined ? { subTool: opts.sub_tool } : {}),
          startedAt,
          durationMs: Date.now() - startMs,
          ...(discarded ? { outcome: 'error' as const } : {}),
        })
        .catch((err: unknown) => log.error('argo ai usage record failed', err))
    }

    if (!discarded) return content

    log.warn('argo ai completion returned empty/truncated content', {
      sub_tool: opts.sub_tool,
      finishReason,
      maxTokens,
      attempt,
    })

    if (attempt === 0) {
      maxTokens *= 2
      continue
    }
    throw new Error(
      `AI completion returned no usable content (finish_reason: ${finishReason ?? 'unknown'})`,
    )
  }
  // Unreachable — the loop above always returns or throws.
  throw new Error('AI completion failed unexpectedly')
}
