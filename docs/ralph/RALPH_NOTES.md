# RALPH Notes — Hermes Chat Phase B

Each group appends its learning notes below (what was built, deviations, gotchas, security
notes, tests, future improvements). Distilled into `docs/migrations/` at `/ralph cleanup`.

## Group 1: Data-model foundation (summary + type columns)

### What was implemented

Added `summary` (nullable text) and `type` (nullable text, `$type<HermesThreadType>()`) columns
to `hermesThread` in `schema.ts`, exported `HERMES_THREAD_TYPES` const tuple and
`HermesThreadType` union type. Generated migration `0010_far_george_stacy.sql` and hand-edited
to add `IF NOT EXISTS` on both `ADD COLUMN` statements for idempotency. Extended the
`beforeAll` in `hermes.test.ts` to apply both `0009` and `0010` migrations. Added `summary` and
`type` to `ThreadSchema` (API) and `HermesThread` (dashboard). Added a test asserting both
fields are `null` for a fresh thread.

### Deviations from prompt

None — implemented exactly as specified. The formatter (oxfmt) reformatted the `z.enum().nullable()` call for `type` in `ThreadSchema` into a multi-line form; kept as-is since it's correct style.

### Gotchas & surprises

- `drizzle-kit generate` does NOT emit `IF NOT EXISTS` on `ADD COLUMN` — must hand-edit every
  new Hermes migration before committing.
- Postgres emits `NOTICE` (code `42701`) for already-existing columns when idempotent SQL runs
  — these appear in test output but are not failures.
- oxfmt auto-reformats the drizzle meta JSON files — must run `oxfmt` after `db:generate` or
  the format check will fail.

### Security notes

No security-relevant changes — purely additive nullable columns with no user-supplied data flow.

### Tests added

- Extended `beforeAll` in `hermes.test.ts` to also apply `0010_far_george_stacy.sql`.
- New test `'returns summary and type as null for a fresh thread'` in `describe('thread read CRUD')`.

### Future improvements

- Group 2 will populate `summary` and `type` via a DeepSeek classifier after each turn (similar
  to the existing `titleThreadIfNeeded` pattern).
- The `HERMES_THREAD_TYPES` tuple could be exposed via `@argo/api` to avoid the mirror type in
  the dashboard, but the current manual-mirror pattern is consistent with other dashboard types.

## Group 2: Summary + type classification (DeepSeek)

### What was implemented

Added `GenerateSummary` type, `deepseekSummarize` (one `aiComplete` call returning
`{"summary":"...","type":"..."}` JSON, with code-fence stripping, defensive `JSON.parse`, type
coercion to `HERMES_THREAD_TYPES` with `'general'` fallback, and 200-char summary cap), and
`summarizeThreadIfNeeded` (idempotent `isNull(summary)` guarded UPDATE, same fire-and-forget
pattern as `titleThreadIfNeeded`). Added `generateSummary` to `HermesRouteDeps` with
`deepseekSummarize` as the default. Wired both calls in `onFinish` alongside the existing titler,
skipping on abort/error. Added 5 new tests in `describe('auto-summarization')`.

### Deviations from prompt

Type coercion (`HERMES_THREAD_TYPES.includes(rawType as HermesThreadType) ? rawType : 'general'`)
is done in both `deepseekSummarize` (for the live path) and `summarizeThreadIfNeeded` (as a safety
layer, enabling the test to inject mocks with invalid type strings and verify coercion at the DB
write level). This double-coercion is intentional — it makes the injectable contract `{ summary:
string; type: string }` (loose), which simplifies tests.

### Gotchas & surprises

- `HermesThreadType` was not imported in `hermes.ts` — required adding it explicitly to the schema
  import alongside `HERMES_THREAD_TYPES`. TypeScript error revealed it; easy fix.
- The fire-and-forget `.catch` path correctly suppresses errors from the summarizer mock that
  throws — but the `log.error` call still prints to stderr in tests. These lines are expected and
  don't indicate test failures.
- Summary is generated once per thread (not refreshed on subsequent turns). Refresh is deferred
  future work; the `isNull` guard is the single source of truth for "generated or not."

### Security notes

No new attack surface. The summarizer output (summary text, type) comes from DeepSeek, not from
user input, so XSS/injection concerns don't apply here. Summary is stored as plain text, not
rendered as HTML.

### Tests added

All in `apps/api/src/routes/hermes.test.ts`, `describe('auto-summarization')`:

- `'writes summary and type on the first finished turn'`
- `'does not re-summarize a thread that already has a summary'`
- `'coerces an unknown type to "general"'`
- `'swallows errors from the summarizer (fire-and-forget; malformed JSON case)'`
- `'skips summarization on an aborted turn'`

### Future improvements

- Refresh summary when the thread title changes (re-classify after significant new context)?
  Currently deferred — single-shot on first turn only.
- The `deepseekSummarize` prompt could be improved to produce more specific type classifications;
  initial prompt is intentionally simple.
- Consider exposing `deepseekSummarize` for direct unit testing (currently internal) if the
  parsing/coercion logic grows more complex.

## Group 3: Diagrams I — mermaid bundled + themed

### What was implemented

Created `mermaid-diagram.tsx` — a bundled inline React component that renders mermaid diagrams
using the already-installed `mermaid@11.15.0` package (no CDN, no iframe). `readMermaidColors()`
reads live Mantine CSS vars (`--mantine-color-default-hover`, `--mantine-color-default-border`,
`--mantine-color-text`, `--mantine-color-dimmed`, `--mantine-font-family`) and passes them as
`themeVariables` to `mermaid.initialize()` with `securityLevel: 'strict'` and `theme: 'base'`.
The component debounces the source (250ms), uses a per-render unique ID via a `useRef` counter +
`useId()`, and re-initializes + re-renders on `colorScheme` change. Error fallback mirrors the
`SmartCard` pattern: a `Text c="dimmed"` message + `Code block` of the raw source. Updated
`message-markdown.tsx` to route `lang === 'mermaid'` to `<MermaidDiagram>` instead of
`<DiagramFrame kind="mermaid">`. `DiagramFrame` still handles `vega-lite` (retired in Group 4).

### Deviations from prompt

Used async/await with try/catch inside a `void (async () => { ... })()` IIFE rather than
`.then().catch()` chaining — cleaner and avoids the `promise(always-return)` oxlint warning that
fires when a `.then()` callback is side-effect-only (no return value or throw).

### Gotchas & surprises

- `useId()` returns `:r0:`-style IDs with colons; mermaid uses the render id as a CSS selector
  internally and fails on colons — must strip with `.replace(/[^a-zA-Z0-9]/g, '')`.
- `mermaid.initialize()` is global but concurrent calls from multiple instances are fine in
  practice since all instances share the same theme; the per-render counter ensures unique
  `render()` ids to avoid DOM id collisions between overlapping async renders.
- `colorScheme` in the `useEffect` deps satisfies the linter even though it's not directly
  referenced in the effect body — it's there because `readMermaidColors()` reads live CSS vars
  that change on theme toggle. Added an `eslint-disable-next-line` comment explaining why.
- The `check-theme.mjs` guard only scans `.ts`/`.tsx` files, not `.module.css` — CSS vars in
  the CSS module are not constrained by the hex guard.
- Pre-existing oxlint warnings (no-array-sort, no-array-reverse in other files) persist but are
  not my responsibility; new file introduced 0 new warnings.

### Security notes

`securityLevel: 'strict'` causes mermaid v11 to run its built-in DOMPurify pass on the SVG
before returning it. The SVG is injected via `dangerouslySetInnerHTML` — safe because the
content has been DOMPurify'd by the library before reaching the component. This is the
documented safe pattern for non-iframe mermaid rendering. No additional DOMPurify dependency
was introduced; mermaid bundles its own.

### Tests added

None — no dashboard test harness. QA notes: valid flowchart renders inline and themes correctly;
light/dark toggle re-themes; malformed diagram shows the error fallback with raw source; no
network request to jsDelivr for mermaid (all bundled).

### Future improvements

- Group 4 retires the vega-lite CDN path, completing the full diagram-frame.tsx deletion.
- Could add a loading state (spinner or skeleton) between debounce expiry and render completion
  for large diagrams that take >200ms to render.
- `mermaid.initialize()` is called on every render; could be optimized to only re-initialize
  when the theme actually changes (compare color strings before calling).

## Group 4: Diagrams II — vega-lite bundled + retire iframe

### What was implemented

Replaced the CDN/iframe Vega-Lite path in `diagram-frame.tsx` with `vega-lite-diagram.tsx`:
a bundled inline React component that compiles Vega-Lite specs to Vega specs (`vega-lite`
`compile()`), parses them into a Vega runtime (`vega.parse()`), and renders headlessly to SVG
(`view.toSVG()`) using the AST expression interpreter to avoid `eval`/`Function`. Deleted
`diagram-frame.tsx` and `diagram-frame.module.css` entirely. Added `vega-interpreter` as a direct
dependency (removing `vega-embed` which was the only prior consumer). Updated `message-markdown.tsx`
to route `vega-lite` fences to `VegaLiteDiagram`.

### Deviations from prompt

- Reused `mermaid-diagram.module.css` classes (`root`/`error`) rather than creating a new CSS
  module — the visual treatment (border, radius, background, padding, overflow) is identical.
- New dep `vega-interpreter@2.2.1` was added as a direct dep (previously a transitive dep of
  `vega-embed`). It is small (~15kB) and required for the CSP-safe expression evaluation path.
  `vega-embed` was removed (no other consumer).

### Gotchas & surprises

- **`vega.parse()` `ast` option**: `{ ast: true }` must be passed to `vega.parse()` alongside
  `expr: expressionInterpreter` on the View — without `ast:true`, expressions are compiled to JS
  strings (and use `Function`) rather than stored as AST nodes for the interpreter to walk.
  This combination is what `vega-embed` does internally.
- **Headless rendering**: `renderer: 'none'` on the View, then `runAsync()` + `toSVG()` gives
  an SVG string without needing a DOM container. The mermaid pattern uses the same shape.
- **`vega-interpreter` not in vega's bundle**: The interpreter is a separate package; vega does
  not re-export it, so importing `expressionInterpreter` from `vega` fails. Must import from
  `vega-interpreter` directly.
- **Spec sanitization scope**: Only `data.url` (remote data) is rejected. Expressions in
  `transform.calculate`/`filter` are safe because the interpreter runs them without `eval`.
  Rejecting them would make many valid LLM-generated charts unusable.

### Security notes

- **No `eval`/`Function`**: `vega.parse(spec, config, { ast: true })` + `expr: expressionInterpreter`
  replaces the default JS codegen with AST interpretation. Expressions never reach `Function()`.
- **Remote data blocked**: `hasRemoteDataUrl()` recursively scans the parsed spec for any object
  with a string `url` property. In Vega-Lite, `url` as a key only appears in data specs (not in
  mark/encoding). This is a conservative reject — false positives are unlikely and acceptable.
- **SVG XSS**: Vega generates SVG programmatically via its rendering engine; user-supplied data
  never reaches `<script>` tags. `dangerouslySetInnerHTML` is safe for the same reason as
  mermaid (library controls SVG generation, not user strings).

### Tests added

None — no dashboard test harness. Manual QA notes: a simple bar chart with `data.values`
renders inline and themes with `--vx-*` colors; light/dark toggle re-renders with updated
palette; a spec with `data.url` shows the rejection error; malformed JSON shows the parse
error fallback; no jsDelivr request in network tab.

### Future improvements

- Loading state (spinner) during the async compile+render pipeline for large specs.
- Could attempt to sanitize (rather than reject) specs with `data.url` by substituting
  empty `data.values: []`, but rejection with a clear message is safer and simpler.
- `vega-interpreter` ships with both AST walk and a fallback — could add a lint check
  to ensure `ast: true` is always paired with `expr: expressionInterpreter`.

## Group 5: Slack-style inline-expandable thread feed

### What was implemented

Rebuilt the two-pane `chat-page.tsx` into a single-column thread feed. New files:
`thread-feed-row.tsx` (each row: type badge + title + summary + timestamp + chevron, plus a
`Collapse`-animated inline conversation when expanded) and `thread-feed-row.module.css` (neutral
hover/expanded fills, never the identity blue). `chat-page.tsx` is now a plain vertical `Stack`
with a sticky "Hermes / New chat" header bar and a `ScrollArea` containing the feed rows.
`chat-view.tsx` and `chat-conversation.tsx` gained an optional `hideHeader` prop — when the
conversation is embedded inside a feed row, the redundant title bar is suppressed. The composer
now includes disabled placeholder `ActionIcon`s for attach (paperclip) and voice (microphone),
ordered before the send/stop cluster, ready for Groups 6–7 to wire up.

### Deviations from prompt

- Mobile breakpoint logic (`useMediaQuery`) was removed entirely — the single-column feed is
  inherently responsive; no `onBack` affordance is needed.
- The old `ThreadList` component is no longer used by `chat-page.tsx` but was left on disk (not
  deleted) since it's not exported from `index.ts` — it becomes dead code but causes no harm.
  Cleanup is deferred to a post-loop tidy.
- Conversation height when expanded is fixed at `h={480}` (480px) rather than a `dvh` expression
  — Mantine v9's `Collapse` works by measuring `scrollHeight` at runtime, and a fixed pixel value
  is the most reliable target for the height animation.

### Gotchas & surprises

- Mantine v9 `Collapse` prop is `expanded` (not `in` from react-transition-group, not `opened`
  from Mantine v7). TypeScript caught the mismatch immediately — check `.d.ts` before assuming.
- `Collapse` with `keepMounted={false}` (default) unmounts children after the exit animation.
  This means each `ChatConversation` / `useChat` instance is cleaned up when collapsed and
  re-hydrated from TanStack Query cache on re-expand. Acceptable for personal-use thread counts.
- The type → color map intentionally uses only allowed Mantine accents (`blue`, `orange`, `gray`,
  `yellow`, `green`) — the `check-theme.mjs` guard enforces this via oxlint.

### Security notes

No new attack surface. Type badge labels come from a static `Record<HermesThreadType, string>`
map keyed on validated enum values — no user-supplied strings reach Badge content.

### Tests added

None — no dashboard test harness. Manual QA checklist: feed lists threads with badge+title+
summary+timestamp; expanding streams a live conversation via the existing `useChat` path;
collapsing unmounts the conversation; new-chat auto-expands; dark/light themes correct; the
disabled attach/mic icons appear in the composer.

### Future improvements

- Delete the now-unused `thread-list.tsx` and `thread-list.module.css` in a post-loop cleanup
  commit.
- Consider `keepMounted={true}` on `Collapse` if re-open latency (spinner from message fetch)
  becomes noticeable — React 19 `Activity` preserves state while hidden.
- The conversation pane height (480px) could become a user preference or auto-scale to available
  viewport height with a CSS `min()`/`max()` expression once Mantine's `Collapse` height
  animation is confirmed stable with `dvh` values.

## Group 6: Audio in/out (STT + TTS)

### What was implemented

Wired the existing `/ai/v1/audio/*` API endpoints into the composer and transcript: mic button
records audio via `MediaRecorder`, POSTs the blob to `/api/ai/v1/audio/transcriptions`, and
appends the returned transcript to the input. A read-aloud `ActionIcon` on assistant messages
POSTs the text to `/api/ai/v1/audio/speech`, creates a blob URL, and plays it via `new Audio()`.
Voice-recorded messages persist a duration-only `AudioRef` on `payload.audio` via an extended
`ChatBodySchema`. The `AudioView` smart-card placeholder was replaced with a real `<audio>` player
(controls, with a "No audio available" fallback when `src` is absent). 503 responses from the
audio-proxy disable both controls for the session via `audioAvailable` state.

### Deviations from prompt

- `AudioRef.url` was made optional (`url?: string`) in `schema.ts` so the voice-input audio ref
  can be persisted without a URL (the recording blob is ephemeral; only duration is stored). No DB
  migration needed — it is a TypeScript interface over a JSONB column, not a schema constraint.
- TTS audio refs are not persisted (always regeneratable on demand from message text). Only the
  user's voice input ref is stored.
- The `getPendingAudio` ref pattern (`() => ref.current`) is used instead of a `sendMessage` body
  option — `prepareSendMessagesRequest` in the `DefaultChatTransport` is synchronous, so reading
  the ref inside it is safe; clearing immediately after `sendMessage()` is correct.

### Gotchas & surprises

- `exactOptionalPropertyTypes: true` in the API tsconfig requires conditional spreading for the
  optional `userAudioDurationMs` arg — `{ ...cond ? { key: val } : {} }` rather than
  `{ key: val | undefined }`.
- oxlint `eqeqeq` rule rejects `!= null`; must use `!== null` even in the "coerce null +
  undefined" pattern. The rule fires on both API and dashboard code.
- oxlint `prefer-add-event-listener` warns on `audio.onended = ...`; use
  `audio.addEventListener('ended', handler, { once: true })` instead.
- `MediaRecorder.ondataavailable` chunks arrive asynchronously; `onstop` fires after all chunks
  are queued, so `recordingChunksRef.current` is fully populated when `finishRecording` runs.
  Releasing the mic (`stream.getTracks().forEach(t => t.stop())`) must happen in `onstop`, not
  during `stopRecording()` — the latter just calls `recorder.stop()` which is async.

### Security notes

- No XSS: STT transcript is `text` content only, set via `setInput()` into the controlled
  textarea. It never reaches `dangerouslySetInnerHTML`.
- TTS audio is fetched server-side as a binary blob; a browser blob URL is created
  (`URL.createObjectURL`) and revoked in the `ended`/`error` handler — no external URL is ever
  set on an `<audio>` element directly.
- The `<audio src={card.src}>` in `AudioView` (smart-card) renders a Hermes-supplied URL. This
  is the same trust boundary as `<a href>` — acceptable for a personal-use agent surface where
  Hermes is the trusted source.
- `AudioRef.url` being optional means the player component's conditional `{card.src ? <audio> :
fallback}` is the only gate; no empty-string sentinels needed.

### Tests added

None — no dashboard test harness; API hermes tests (23) all pass unchanged. The `userAudioDurationMs`
field is optional and backwards-compatible; existing test requests omit it and persist `null` audio
payload as before.

### Future improvements

- Add a `PATCH /hermes/messages/:id/payload` endpoint so TTS refs can be persisted after the
  assistant message is already written (enabling replay from thread history).
- Replace the native `<audio controls>` in `AudioView` with a custom Mantine-themed player
  (progress bar, time display) once media-session / range-request proxy is in place.
- Consider a visual waveform animation on the mic button while recording (WebAudio `AnalyserNode`).
- `audioAvailable` state resets when the thread is remounted (keyed by thread id). Consider
  persisting the "audio unavailable" state in a Zustand slice so it survives thread switching.

---

## Group 7: Attachments

### What was implemented

Added an **attach menu** (paperclip `Menu` with Long Text / Image / File entries) to the Hermes
Chat composer. Long Text opens a `Modal` with title + content textarea; File and Image each use a
Mantine `FileButton`. Pending attachments render as removable chips above the textarea before send.
The full `Attachment` discriminated union (`TextAttachment | ImageAttachment | FileAttachment`) was
added to both `apps/api/src/db/schema.ts` (replacing the v1 `type:'text'-only` interface) and
`types.ts` on the dashboard. Attachments flow through the transport (`getPendingAttachments`
callback), are carried in `ChatBodySchema.attachments`, and are persisted in `payload.attachments`
on the user message via `persistTurn`. On thread reload, `toUIMessages` hydrates
`metadata.attachments` from the payload and `MessageRow` renders them: image → thumbnail with
border, file → name+size chip, text → title chip with expand/collapse card. Text attachment content
is also appended to the Hermes-bound message text so Hermes can read it.

### Deviations from prompt

- Kept the schema change as TypeScript interface only (JSONB column is schemaless — no migration
  needed). The prompt mentioned "extend the type if you added Image/File kinds" which is what was
  done without a DB migration.
- Images and files are NOT forwarded to Hermes (Hermes would need multimodal message handling).
  Only text attachment content is appended to the message text. Noted as future work.

### Gotchas & surprises

- **Mantine v9 `Collapse` uses `expanded` not `in`** — Mantine v6/v7 used `in` (the React
  transition prop); v9 renamed it to `expanded`. TypeScript caught this immediately.
- **`FileReader.onload` triggers the `unicorn/prefer-add-event-listener` lint rule** — must use
  `reader.addEventListener('load', ...)` instead.
- `exactOptionalPropertyTypes` still bites: `...(file.name ? { fileName: file.name } : {})` is
  the required idiom for optional fields from a potentially-empty `file.name`.

### Security notes

- Inline data URL storage in JSONB capped at 2 MB to bound JSONB size. Larger files require a
  dedicated server-side upload pipeline (deferred).
- Images are rendered via Mantine `Image` with the data URL as `src` — no sanitization needed
  (data URLs never hit the network, XSS is not a concern for `<img src="data:...">` in this context).
- File data URLs are never executed (download chip only, no `eval`, no dynamic `<script>`).

### Tests added

- `hermes.test.ts`: "persists user-supplied attachments in the user message payload" — verifies
  that `attachments` in the request body ends up in `payload.attachments` on the persisted user
  message row.

### Future improvements

- Forward image attachments to Hermes as multimodal message parts once Hermes gains vision support.
- Server-side upload pipeline for files > 2 MB (presigned S3 / VPS-local storage).
- Live attachment preview before send: image thumbnail in the chip row, not just an icon+name.
- `pendingAttachmentsRef` is cleared synchronously after `sendMessage`; if AI SDK v5 ever exposes
  a `metadata` field on `sendMessage` the live user message could render attachments immediately
  before `onFinish` re-fetches the transcript.
