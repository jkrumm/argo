# Argo — Hermes Chat Phase A (2026-06-08 → 2026-06-09)

## Goal

A thread-first, Slack/WhatsApp-style chat surface inside the Argo dashboard that talks
directly to the Hermes agent core over its OpenAI-compatible API (port 8642). Argo owns
the verbatim transcript in Postgres; Hermes holds only compressed per-session agent state.
Phase A is the core chat (Groups 1–6); output shaping, audio, attachments, and the Slack
feed layout are Phase B.

## Outcome

Groups 1–6 landed and pass the full validation gate (lint + theme guard, format, 3×
typecheck, dashboard build). Working threaded chat on Mac + iPhone: a streaming Elysia
proxy with a tool-progress tap, Postgres thread/message persistence, DeepSeek auto-titling,
and a rich Mantine-native markdown renderer. Post-loop QA wired the live upstreams: the
Hermes API server is enabled on the tailnet, DeepSeek titling routes directly to the IU
unified endpoint (one config local + prod, no bridge/localhost), failed turns persist as
`error`, and the title-refresh race is fixed with a bounded poll. On branch
`feat/hermes-chat`, not yet merged; prod Hermes reachability is gated on a Tailscale ACL.

## Groups

| #   | Title                           | Outcome                                                                                                    |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Foundation & scaffolding        | Deps (AI SDK v5, pinned exact), env, Drizzle schema (`hermes_thread`/`hermes_message`), route + page stubs |
| 2   | Hermes chat proxy + persistence | Streaming `UIMessage` proxy; raw-SSE tool-progress tap (filter, not tee); `onFinish` persistence           |
| 3   | General AI gateway (`/ai/v1/*`) | OpenAI-compatible proxy: DeepSeek chat + STT + TTS; `aiComplete()` in-process seam                         |
| 4   | Read CRUD + DeepSeek titling    | Thread list/transcript/PATCH; fire-and-forget idempotent auto-titling; interrupted handling                |
| 5   | Frontend core chat              | `useChat` transport, responsive list+detail, live streaming, Mantine markdown                              |
| 6   | Smart cards + rich rendering    | `card`/`mermaid`/`vega-lite` blocks, inline accents, sanitize pipeline, progress chips                     |

## Architectural decisions that survived

- Tool-progress tap **filters** the custom `hermes.tool.progress` SSE events out of the SDK branch (a literal `tee()` would feed non-OpenAI frames into the parser and break it).
- "New chat" creates the thread server-side first (`POST /hermes/threads`) so the client always streams with a known `threadId`.
- Tool-progress renders via `useChat` `onData` as transient state — never persisted into the transcript `parts`.
- Auto-titling is an injectable dep (DeepSeek via `aiComplete`) fired fire-and-forget on `onFinish`, idempotent under `isNull(title)`.
- Custom `hermes-badge`/`hermes-mark` elements + a widened sanitize-schema allowlist, rather than overloading `<span>`.
- `persistTurn` stamps a per-index `created_at` so user→assistant order is deterministic on read.

## Notable gotchas worth remembering

- `bun add --exact 'pkg@^5'` does NOT pin exact — resolved versions had to be written back by hand.
- `useChat` reads `messages` only at init for a given id → hydration must key the component by thread id.
- `streamText` observes abort lazily (only on the next `reader.read()`) — a parked fake upstream hangs the abort test; the fake must keep trickling deltas.
- `exactOptionalPropertyTypes` forces `| undefined` on Zod `.optional()`-derived helper param types.
- Local dev DB ownership: argo-schema objects owned by the superuser broke `runMigrations()` (0004 `DROP INDEX`) → boot 502; fixed via `ALTER ... OWNER TO argo` (db:sync/postgres-setup don't fix it).
- `DeepSeek-V4-Flash` is a LiteLLM-bridge alias, not a real IU model id; the current gateway (`unified-endpoint-main`) serves it directly, but the stale `op://common/anthropic/OPENAI_BASE_URL` pointed at an older gateway without it (corrected during QA).

## Deferred work

- **Diagrams (hard constraint):** the shipped CDN/iframe renderer is REJECTED — Phase B must bundle + theme `mermaid`/`vega-lite` inline per DESIGN.md, with XSS contained without origin isolation (mermaid `securityLevel:'strict'`, sanitize source, Vega safe mode). See memory `hermes-diagram-rendering`.
- **Usage-tracking:** log Argo's AI-call token usage (the response `usage` object) to the usage-tracker tagged `application=argo`.
- **Audio-proxy wiring** (voice-in / read-aloud) — Phase B.
- **Output shaping (Group 7):** get Hermes to actually emit `card`/`mermaid`/`vega-lite`/accent formats — the renderer is ready, the producer is not.
- **Slack-feed thread layout** off `docs/diagrams/ChatWireframe.svg` — the Phase B headline (titles/summaries as input).
- Deep-linking the selected thread; thread context menu (rename/pin/archive surfaced); rendering reasoning parts.
- **Prod `HERMES_*` reachability:** Tailscale ACL (`tag:vps` → `tag:mac` `:8642`) + Hermes bound to the tailnet interface; then `make argo-env` + redeploy + verify.

## Tests added

~17 API tests (mocked upstreams; DB via direct migration apply): streaming + tool-progress injection, bearer isolation (absent client-side / present upstream), verbatim persistence + ordering, read CRUD (list/transcript/PATCH), titling (titled once, idempotent), interrupted + failed-stream (`error` status), and 503 when the upstream is unconfigured. No dashboard test harness exists in this repo (frontend QA is manual).
