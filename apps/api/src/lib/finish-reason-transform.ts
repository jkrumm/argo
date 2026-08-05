// basalt-agent-allow — deliberate per locked decision D3: apps/api stays on ai@5. This is the file that neutralizes the v5/v7 skew producer-side (rewriting finishReason 'unknown' -> 'other'), so it is the one legitimate place this import belongs (docs/HERMES-CHAT-V2.md).
import type { FinishReason, UIMessageChunk } from 'ai'

// apps/api stays on ai@5 permanently (locked decision D3 — see routes/hermes.ts's
// deliberate-suppression comments for the full rationale). ai@5's LanguageModelV2FinishReason
// (@ai-sdk/provider@2.0.3, node_modules/.bun/@ai-sdk+provider@2.0.3/node_modules/
// @ai-sdk/provider/dist/index.d.ts:1081) has 7 values, including 'unknown'.
// @ai-sdk/openai-compatible's mapOpenAICompatibleFinishReason
// (apps/api/node_modules/@ai-sdk/openai-compatible/dist/index.mjs:160-174) returns
// 'unknown' from its `default:` branch whenever Hermes' upstream `finish_reason` is
// null or unrecognized — a real, reachable case, not a hypothetical.
//
// The dashboard is on ai@7.0.18, whose UIMessageStream 'finish' chunk is validated by
// a `z.strictObject` (apps/dashboard/node_modules/ai/dist/index.js:6395-6406) accepting
// only 6 of those 7 values — 'unknown' is absent — and a `strictObject` REJECTS the
// whole chunk on an out-of-enum value. A raw 'unknown' finishReason therefore breaks
// the dashboard's client-side stream parse outright.
//
// This is the sole neutralization point for that skew (never an apps/api upgrade —
// D3). Checked directly against the installed ai@5 UIMessageChunk union
// (node_modules/ai/dist/index.d.mts:1934-1951): `finishReason` appears ONLY on the
// `type: 'finish'` member, as `finishReason?: FinishReason` (optional). The sibling
// `type: 'finish-step'` member carries no `finishReason` at all — there is nothing
// else to rewrite.
// These are exactly the 6 members of ai@7's enum, in its own order. Keep it that way:
// this set is a mirror of the consumer's accept set, not a hand-picked subset. 'other'
// belongs in it because v7 accepts 'other' — omitting it would still behave correctly
// (an omitted 'other' is rewritten to 'other'), which is precisely why the error would
// go unnoticed and why the set must be read as the authoritative mirror it claims to be.
const V7_ACCEPTED_FINISH_REASONS = new Set<FinishReason>([
  'stop',
  'length',
  'content-filter',
  'tool-calls',
  'error',
  'other',
])
// The bucket a disallowed value maps to — semantically "the provider did not tell us".
// A separate constant so the mapping target reads as a deliberate choice, not a magic
// string. It is also a member of the accept set above, so a chunk that already carries
// 'other' passes through by reference rather than being needlessly re-spread.
const V7_FALLBACK_FINISH_REASON: FinishReason = 'other'

/**
 * Rewrite a `finish` chunk's `finishReason` to `'other'` when it falls outside ai@7's
 * accepted 6-value set (currently just 'unknown', ai@5's only extra value) — the
 * semantically correct bucket for "the provider did not tell us". Every other chunk,
 * including a `finish` chunk with an already-legal or absent `finishReason`, passes
 * through byte-identical: no key is added, since ai@7's finish-chunk schema is a
 * `strictObject` that rejects an unrecognized key exactly as hard as a bad enum value.
 */
export function rewriteUnknownFinishReason(chunk: UIMessageChunk): UIMessageChunk {
  if (chunk.type !== 'finish') return chunk
  if (chunk.finishReason === undefined) return chunk
  if (V7_ACCEPTED_FINISH_REASONS.has(chunk.finishReason)) return chunk
  return { ...chunk, finishReason: V7_FALLBACK_FINISH_REASON }
}

/** TransformStream wrapper around `rewriteUnknownFinishReason`, composed onto the
 * UIMessageStream via `.pipeThrough(...)` before `writer.merge(...)` in routes/hermes.ts. */
export function finishReasonTransform(): TransformStream<UIMessageChunk, UIMessageChunk> {
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(rewriteUnknownFinishReason(chunk))
    },
  })
}
