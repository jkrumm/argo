# Hermes Chat — Design Reference

> **Status (2026-09-07): shipped.** P0–P1, B1–B4 (basalt-ui 1.10–1.13), A1–A3 and A5 landed — the thin idempotent proxy, the named-event transport, the dashboard on basalt's agent primitives, voice on the composer slots.
> **Deferred:** A4 (Slack rows in the feed — the bot token carries `chat:write`, but `sendMessage` still lacks the `not_in_channel` join retry and no dashboard Slack surface exists) and the hermes-agent half of A6 (its `CLAUDE.md` `API_SERVER_ENABLED` correction).
> This file is the design reference — the phase-by-phase build record, the defect audit that drove it, and the two earlier specs it superseded were all retired 2026-09-07; `git log --since=2026-08-02 -- apps/api/src/routes/hermes.ts apps/dashboard/src/features/hermes-chat` is the build history.

## What it is

One feed, three kinds of row, Slack-shaped rather than chat-shaped:

| Row type | Source | Interaction |
|-|-|-|
| **Hermes thread** | Postgres `hermes_thread` | Expand inline → transcript + composer; streams live |
| **Slack channel** (alerts, updates, `#hermes`) | existing `/slack/*` routes | Expand inline → recent messages; reply from the composer |
| **Outcome / notification** | agent-emitted | Read-only summary card |

Slack write already exists server-side — `apps/api/src/routes/slack.ts:273` (send to channel), `:300`
(reply in thread), backed by `clients/slack.ts:425`.

Argo's Elysia API sits in the middle as a **thin proxy**: auth boundary, persistence tee, resume —
it does not re-encode the protocol through `streamText`. The Hermes listener is not
browser-addressable (no CORS, host-privileged bearer, no TLS, no stream resume of its own), so the
proxy is load-bearing, not incidental. Postgres remains the transcript's source of truth; Hermes
sessions are the agent's own working memory. Voice/audio stays consumer-side — `basalt-ui` exposes
composer slots, never an audio implementation.

### Render catalog

Everything renders through `basalt-ui/content`'s streaming-safe pipeline (block-split lexing,
memoized settled blocks, remend applied only to the tail block), with Argo supplying app-specific
renderers through the fence registry:

| Form | Owner | Notes |
|-|-|-|
| Markdown + GFM tables, code blocks (shiki) | basalt | — |
| Callouts, collapsibles | basalt | `Callout`, and the MDX component map |
| Mermaid | basalt | Upgrade gated on `settled` — no error box mid-fence |
| Tool-call chips | basalt | `ToolChip` over AI SDK v7's seven-state lifecycle (`input-streaming` … `output-denied`; there is no `running` state — `input-available` *is* running). Collapsed by default, expandable to args + result |
| ` ```card ` (infra/todo/note), ` ```vega-lite ` | Argo | App domain, via the fence registry |
| Inline accents (`:badge[…]`, `==mark==`) | Argo | Remark plugin passed into basalt `Markdown` |
| Audio player, read-aloud, voice input | Argo | Composer slots + a part renderer |

The invariant that matters: **nothing may flicker into an error state mid-fence** — basalt's
`settled` flag makes that structurally impossible.

## Locked decisions

| # | Decision | Rationale |
|-|-|-|
| D1 | **`basalt-ui` owns the complete threaded agent-chat surface** — assembled from primitives that are *also* individually exported | The consumer gets a correct default and an escape hatch, without a fork |
| D2 | **TanStack-grade strictness**: exhaustive discriminated unions, no untyped escape hatches, oxlint guards that make known failure modes unrepresentable | Types and guards are the deliverable, not decoration |
| D3 | **Dashboard stays on AI SDK v7; `apps/api` stays on v5.** The skew is neutralized by a producer-side transform, not a migration | v7's accept set is a strict superset of v5's emit set by type name — the skew costs exactly one enum value (`finishReason: 'unknown'`, rewritten to `'other'` by a `TransformStream`). `basalt-ui` peers `ai@^7.0.15` client-side; `apps/api` doesn't import `basalt-ui` at all |
| D4 | **Argo's Elysia API stays a *thin* proxy**: auth boundary, persistence tee, resume — never re-encoding the protocol through `streamText` | See "What it is" above |
| D5 | **Postgres remains the transcript's source of truth**; Hermes sessions are the agent's working memory | Argo persists display-level parts (cards, audio, attachments) Hermes never stores |
| D6 | **Voice/audio stays consumer-side.** `basalt-ui` exposes composer slots, never an audio implementation | Framework boundary recorded in `basalt-ui`'s own docs |
| D7 | **Vega-Lite stays** as an Argo-level fence renderer, kept current via `/upgrade-deps` | Pinned versions are past all known advisories |
| D8 | **Sequencing: `basalt-ui` ships first**, then Argo rebuilt in one pass (API + client together) | Avoids client stopgaps the rebuild would throw away |
| D9 | **Surface scope**: Hermes threads + Slack channels (read *and* reply) + voice, in one feed | — |
| D10 | **Hermes transport is `POST /api/sessions/{id}/chat/stream`** | The only surface with named events carrying `seq`, `run_id`, and `tool.started/completed/failed` including arguments — tool visibility is fixed at the source rather than faked in the renderer |

Two of `basalt-ui`'s own design choices are load-bearing here and should not be quietly reversed:
the `AgentPart` union stays **closed** (foreign parts are a separate `ForeignPart` type resolved
through consumer renderer → re-narrow → exhaustive switch → fallback — folding them into the union
would make `assertNever` accept everything), and the sanitize hook is a **data extension, not a
function** (an additions-only object can't express removal, and basalt appends its sanitize pass
*after* consumer `rehypePlugins` so the escape hatch can't outrun it).

## Explicitly deferred / out of scope

- **A4 — Slack rows in the feed.** Backend write path exists; the dashboard Slack surface and the
  `not_in_channel` join retry on `sendMessage` do not.
- **Structured-output (`response_format`) support in Hermes** — parsed only into an idempotency
  fingerprint and otherwise dropped; fenced output stays a prompt contract plus client-side parsing.
- **Attachment upload endpoints and outbound audio in Hermes** — both would be local patches on a
  hot upstream file.
- **Interactive tool approvals** — only `/v1/runs` exposes them, and its in-memory state is too
  fragile to build on.

## Key references

| Path | Contents |
|-|-|
| `~/SourceRoot/basalt-ui/docs/AGENT-CHAT-SPEC.md` | The framework API specification for the agent-chat primitives Argo consumes |
| `git log --since=2026-08-02 -- apps/api/src/routes/hermes.ts apps/dashboard/src/features/hermes-chat` | What was actually built, phase by phase — the migration record was retired 2026-09-07 |
| `CLAUDE.md`, `DESIGN.md`, `.claude/rules/basalt-*.md` | Design law. Precedence: DESIGN.md > basalt rules > skills |
| `apps/api/.claude/rules/openapi.md` | The agent-facing API contract |
