# Argo — Hermes Chat Phase B (2026-06-09)

## Goal

Transform the Phase A core chat into a thread-first, Slack-style assistant with rich inline rendering (bundled+themed diagrams, cards, accents), per-thread metadata (summary, type), voice I/O, and file attachments. Bundle mermaid and vega-lite; eliminate CDN/iframe and secure against XSS via sandboxed expression evaluation and strict sanitization.

## Outcome

All 8 groups completed in one iteration. Shipped: thread auto-titling + DeepSeek-powered summary/type classification (fire-and-forget), bundled mermaid (strict security, CSS-var theming) and vega-lite (AST interpreter, no eval, remote-data rejection), single-column Slack-style thread feed with inline-expandable conversations, voice record (STT) and read-aloud (TTS), attachment picker (long text/image/file) with persistence and thumbnail rendering, and usage tracking for Argo AI calls tagged by purpose (titling, summarization, hermes-proxy). Diagram rendering is entirely local; no external CDN requests. Feature flags gate voice and file attachments. Codebase is feature-complete for Phase B per DESIGN.md.

## Groups

| #   | Title                           | Outcome                                                                                         |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Data-model foundation           | Added `summary` + `type` nullable columns to `hermesThread`; exported type tuple + union        |
| 2   | Summary + type classification   | DeepSeek auto-classify on thread finish; type coercion with 'general' fallback                  |
| 3   | Diagrams I — mermaid bundled    | Inline React component, `securityLevel: 'strict'`, CSS-var theming, debounced render            |
| 4   | Diagrams II — vega-lite bundled | Inline React component, AST interpreter (no eval), reject remote data URLs                      |
| 5   | Slack-feed layout               | Single-column thread list with type badges + summary; inline-expandable conversations           |
| 6   | Audio in/out                    | MediaRecorder + STT; read-aloud TTS via `/ai/v1/audio/speech`; duration persistence             |
| 7   | Attachments                     | Compose menu (long text/image/file); persist in `payload.attachments`; render thumbnails        |
| 8   | Usage-tracking                  | DeepSeek token capture for Argo calls; tagged `sub_tool` (titling, summarization, hermes-proxy) |

## Architectural decisions that survived

- **Double-coercion of thread type** (live path + DB layer): type string from LLM coerced in `deepseekSummarize`, then again in `summarizeThreadIfNeeded` — enables test injection of invalid types to verify safeguard.
- **Async/await IIFE in diagram render** over promise chaining: cleaner control flow, avoids oxlint `promise(always-return)` warning.
- **CSS-module reuse**: mermaid and vega-lite diagrams share the same `mermaid-diagram.module.css` (root/error/overflow classes).
- **JSONB-only attachment schema** (no migration): TypeScript interface on `payload` allows Image/File kinds without DB schema change.
- **Text attachments only forwarded to Hermes**: image/file attachments persist locally but aren't sent upstream; multimodal Hermes support is deferred.
- **`source='argo'` not `application`** in usage_record: established pattern in existing table; `application` column does not exist.

## Notable gotchas worth remembering

- **`exactOptionalPropertyTypes: true`** requires conditional spreads: `{ ...cond ? { key: val } : {} }` for optional fields, never `{ key: val | undefined }`.
- **Drizzle `db:generate` omits `IF NOT EXISTS`** on `ADD COLUMN` — hand-edit every new Hermes migration to make idempotent.
- **`useId()` returns colons**; must strip with `.replace(/[^a-zA-Z0-9]/g, '')` before using as a mermaid DOM id.
- **Mantine v9 Collapse uses `expanded` not `in`**; v7 used `in` (React transition prop).
- **Vega safe mode requires both `{ ast: true }` AND `expr: expressionInterpreter`** on `vega.parse()` — omitting either falls back to JS codegen (Function/eval).
- **`--vx-*` CSS vars redeclare per `[data-mantine-color-scheme]`**; theme toggle updates palette without JS re-render.
- **oxlint `prefer-add-event-listener`** bans `.onprop = ...` (must use `addEventListener`); **`eqeqeq`** rejects `!= null` (use `!==`).
- **Postgres NULL ≠ NULL in unique constraints**: duplicate nulls don't trigger unique-index violations; harmless here since `source_id` is a UUID per call.

## Deferred work

- Multimodal Hermes: forward image/file attachments once Hermes gains vision + file support.
- Server-side upload pipeline for attachments > 2 MB (presigned S3 / VPS-local storage).
- Custom Mantine-themed audio player (progress bar, time display) to replace native `<audio controls>`.
- Summary refresh on title change (re-classify after new context).
- Loading state (spinner) in diagram render during async compile+render.
- `PATCH /hermes/messages/:id/payload` to persist TTS refs after assistant message write (enable replay from history).
- Waveform animation on mic button during recording; persistent audio-unavailable state across thread switches.

## Tests added

11 new tests: Group 1 (1 test extending migration bootstrap + thread read assertion), Group 2 (5 auto-summarization tests: fresh thread, idempotency, type coercion, error suppression, abort skip), Group 7 (1 attachment persistence test), Group 8 (4 usage-tracking tests: recordUsage call, skip on missing usage, model normalization, DB write). No dashboard test harness (typecheck + build validation only). All API tests pass against live local Postgres.
