/**
 * One-sentence prose from an already-computed verdict, with the reasoning-model
 * token trap handled in one place.
 *
 * Both window endpoints (`/astro/window`, `/marine/window`) end the same way:
 * hand the model a finished, fully deterministic verdict and ask for a single
 * terse sentence about it. Neither may ever depend on the answer — the sentence
 * is an enhancement, and a model outage must not cost the caller their forecast.
 *
 * **The trap this module exists for.** The model behind `aiComplete` is a
 * *reasoning* model, and `max_completion_tokens` caps hidden reasoning tokens
 * and visible content **together**. Size the budget for the sentence and the
 * whole allowance is spent thinking: the call returns HTTP 200 with
 * `finish_reason: "length"` and an **empty** content string. `aiComplete` itself
 * now retries once at double the budget and throws if that still comes back
 * empty — this module only has to turn that throw into a null, never let a
 * sentence outage cost the caller their forecast.
 */

import { log } from '../telemetry.js'

/**
 * Budget for the one-sentence completion. Well above the ~290–600 completion
 * tokens either prompt actually uses, because the failure mode of being
 * slightly too low is silent — `aiComplete` doubles this once internally
 * before giving up.
 */
export const SENTENCE_TOKENS = 16000

export type SentenceCompleter = (
  prompt: string,
  opts: { system?: string; maxTokens?: number; sub_tool?: string },
) => Promise<string>

/**
 * Ask for one sentence about an already-computed verdict.
 *
 * Returns the trimmed sentence, or `null` when the model is unavailable or
 * would not produce content. **Never throws** — every caller treats a null as
 * "no sentence today" and serves the verdict regardless.
 */
export async function completeSentence(
  complete: SentenceCompleter,
  prompt: string,
  opts: { system: string; subTool: string },
): Promise<string | null> {
  try {
    const text = await complete(prompt, {
      system: opts.system,
      maxTokens: SENTENCE_TOKENS,
      sub_tool: opts.subTool,
    })
    const trimmed = text.trim()
    if (trimmed) return trimmed
    log.warn('one-sentence completion came back empty', { subTool: opts.subTool })
    return null
  } catch (error) {
    // A transport/upstream failure, or aiComplete's own retry exhausted — either
    // way, a sentence outage must never cost the caller their forecast.
    log.warn('one-sentence completion unavailable', {
      subTool: opts.subTool,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
