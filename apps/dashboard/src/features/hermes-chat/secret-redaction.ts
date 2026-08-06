// D-D (secrets in tool previews): a real production `payload.toolEvents[].label` has been seen
// carrying a shell command that embeds a secret's environment-variable name (e.g.
// `FOO_TOKEN=$FOO_TOKEN ./deploy.sh`). Two of the named vectors in the brief for that string are
// closed BY CONSTRUCTION in this rebuild, not by this file:
//
//   - the LIVE `data-toolProgress` chunk (which carried `ToolProgress.label`) is never surfaced to
//     the client at all — aiSdkTransport's snapshot-diff only converts 'text' | 'reasoning' |
//     'source-url' | tool-like UIMessage parts to AgentParts; every `data-*` part (including
//     `data-toolProgress`) hits the `default: return []` branch and is silently dropped
//     (node_modules/basalt-ui/src/agent/ai-sdk-transport.ts, diffPart's default arm).
//   - the HISTORICAL `payload.toolEvents[].label` is never read either — threads-adapter.ts's
//     `toChatMessage` maps only `row.parts` (the durable dynamic-tool SDK parts), never `row.payload`.
//
// What IS still rendered, verbatim, by basalt's own frozen `ToolChip` (threadPartRenderers.tool)
// is a tool call's real `input`/`output`/`errorText` — JSON.stringify'd from the SAME underlying
// Hermes tool-call event that produced the flagged preview string (event.args / the parsed tool
// result), just under different field names. That is the one remaining realistic vector for the
// same class of leak, and it's the one this module actually guards: `tool-part-renderer.tsx` runs
// every tool part through `redactPartSecrets` before handing it to `<ToolChip />`.
const SECRET_PATTERNS: readonly RegExp[] = [
  // ${FOO_BAR} / $FOO_BAR — shell variable expansion.
  /\$\{[A-Za-z_][A-Za-z0-9_]*\}/g,
  /\$[A-Za-z_][A-Za-z0-9_]*\b/g,
  // --token=..., --api-key=..., --secret=... — long-flag secret forms. Checked BEFORE the generic
  // assignment pattern below so it claims the leading `--` too, instead of leaving a stray `--`
  // once the generic pattern has already consumed everything from the flag name onward.
  /--[a-zA-Z-]*(?:token|secret|key|password)[a-zA-Z-]*=\S+/gi,
  // FOO_BAR=value / FOO-BAR=value — an env-style assignment, inline or prefixed onto a command.
  /\b[A-Za-z][A-Za-z0-9_-]*=\S+/g,
  // Authorization: Bearer ... — bounded by a closing quote (shell/JSON strings quote header
  // values) or end of string, so a redaction doesn't spill into unrelated trailing content.
  /\bauthorization\s*:\s*[^"]+/gi,
]

const REDACTED = '[redacted]'

/** Redacts anything shaped like an env-var reference or assignment in a single string. */
export function redactSecretText(text: string): string {
  let out = text
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED)
  return out
}

/**
 * Recursively redacts every string leaf of an arbitrary JSON-ish value (tool `input`/`output`),
 * preserving shape. Guards against cycles (defensive — real tool payloads are JSON, never
 * circular, but this runs on `unknown` from the wire).
 */
export function redactSecretsDeep(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return redactSecretText(value)
  if (Array.isArray(value)) return value.map((item) => redactSecretsDeep(item, seen))
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [
        key,
        redactSecretsDeep(v, seen),
      ]),
    )
  }
  return value
}
