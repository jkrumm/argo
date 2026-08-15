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
 * *reasoning* model, and `max_tokens` caps hidden reasoning tokens and visible
 * content **together**. Size the budget for the sentence and the whole
 * allowance is spent thinking: the call returns HTTP 200 with
 * `finish_reason: "length"` and an **empty** content string. No error, no
 * exception — just a summary that is silently always null, which reads like the
 * model being unhelpful rather than like a bug.
 *
 * Worse, the budget needed is not a constant. Measured against these two
 * prompts: a tightly-specified astro prompt spent 288 reasoning tokens, while
 * the more open-ended "tell them not to go" marine prompt blew straight past
 * 900 on two spots out of three. The *tighter* the style instruction, the more
 * the model deliberates — which is the opposite of the intuition, and why
 * picking a single number and moving on does not work.
 *
 * So: start at a budget that comfortably covers the observed range, and if the
 * content still comes back empty, retry **once** at three times the budget
 * before giving up. The retry costs nothing on the common path, and the log
 * line tells you which prompt is drifting.
 */

import { log } from '../telemetry.js'

/**
 * Opening budget. Well above the ~290–600 completion tokens both prompts
 * actually use, because the failure mode of being slightly too low is silent.
 */
export const SENTENCE_BASE_TOKENS = 1200

/** Retry budget, used once when the first attempt returns empty content. */
export const SENTENCE_RETRY_TOKENS = SENTENCE_BASE_TOKENS * 3

export type SentenceCompleter = (
  prompt: string,
  opts: { system?: string; temperature?: number; maxTokens?: number; sub_tool?: string },
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
  for (const maxTokens of [SENTENCE_BASE_TOKENS, SENTENCE_RETRY_TOKENS]) {
    try {
      const text = await complete(prompt, {
        system: opts.system,
        temperature: 0.2,
        maxTokens,
        sub_tool: opts.subTool,
      })
      const trimmed = text.trim()
      if (trimmed) return trimmed
      log.warn('one-sentence completion came back empty', {
        subTool: opts.subTool,
        maxTokens,
        willRetry: maxTokens === SENTENCE_BASE_TOKENS,
      })
    } catch (error) {
      // A transport or upstream failure is not going to be fixed by a bigger
      // budget, so it ends the attempt rather than falling through to the retry.
      log.warn('one-sentence completion unavailable', {
        subTool: opts.subTool,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }
  return null
}
