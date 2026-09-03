import { ToolChip } from 'basalt-ui/agent-chat'
import type { ForeignPart, PartRenderer, PartRenderers, ToolCallPart } from 'basalt-ui/agent'
import { hermesRenderers } from './markdown-part'
import { redactSecretsDeep, redactSecretText } from './secret-redaction'

// D-D: redact a tool part's content-bearing fields before it ever reaches basalt's frozen
// `ToolChip` (which JSON.stringify's `input`/`output`/`rawInput` verbatim — see
// secret-redaction.ts for why this is the one remaining realistic vector). Only touches fields
// that carry Hermes-supplied content; the discriminant fields (`type`, `state`, `toolCallId`,
// `toolName`, `durationMs`, `providerExecuted`, `approval`) pass through untouched so ToolChip's
// state machine still renders correctly.
function sanitizeToolPart(part: ToolCallPart): ToolCallPart {
  const clone: Record<string, unknown> = { ...part }
  if ('input' in clone) clone['input'] = redactSecretsDeep(clone['input'])
  if ('output' in clone) clone['output'] = redactSecretsDeep(clone['output'])
  if ('rawInput' in clone) clone['rawInput'] = redactSecretsDeep(clone['rawInput'])
  if (typeof clone['errorText'] === 'string')
    clone['errorText'] = redactSecretText(clone['errorText'])
  return clone as ToolCallPart
}

// Registered under the `renderers` prop, which is "consulted BEFORE the built-in union" (basalt's
// own ThreadTranscript doc) — so every tool part is intercepted and sanitized here instead of
// falling through to the built-in `threadPartRenderers.tool` (which would render the raw part).
// `part` is typed `ForeignPart` for the same reason `hermesTextRenderer` is (markdown-part.tsx):
// Argo hasn't augmented `BasaltRegister.parts`, and keying this map by the literal string 'tool'
// guarantees only basalt's own ToolCallPart ever reaches it at runtime.
const hermesToolRenderer: PartRenderer<ForeignPart> = ({ part }) => (
  <ToolChip part={sanitizeToolPart(part as unknown as ToolCallPart)} />
)

// The renderers map handed to every `ThreadTranscript`/`ThreadFeedRow` in this feature — lane 2's
// frozen `text` renderer plus this file's sanitizing `tool` renderer. Every other built-in part
// type (reasoning/source/error) falls through to basalt's own `threadPartRenderers`.
export const hermesThreadRenderers: PartRenderers = {
  ...hermesRenderers,
  tool: hermesToolRenderer,
}
