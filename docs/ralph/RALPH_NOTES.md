# Hermes Chat — RALPH Learning Notes

Per-group notes from the autonomous implementation loop. Newest group appended at
the bottom.

## Group 1: Foundation & scaffolding

### What was implemented

- **Dependencies (pinned exact).**
  - `apps/api`: `ai@5.0.196`, `@ai-sdk/openai-compatible@1.0.39`.
  - `apps/dashboard`: `ai@5.0.196`, `@ai-sdk/react@2.0.198`, `react-markdown@10.1.0`,
    `remend@1.3.0`, `remark-gfm@4.0.1`, `remark-directive@4.0.0`, `mermaid@11.15.0`,
    `vega@6.2.0`, `vega-lite@6.4.3`, `vega-embed@7.1.0`.
  - `ai` is added to BOTH workspaces: the server uses `createUIMessageStream` (Group 2);
    the client imports `UIMessage` / `DefaultChatTransport` types from `ai` (Groups 5–6).
- **Env / config** (`apps/api/src/env.ts`, all optional → app boots in test/CI):
  `HERMES_BASE_URL`, `HERMES_API_KEY`, `HERMES_SESSION_KEY` (default resolved, below),
  `DEEPSEEK_BASE_URL`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` (default `DeepSeek-V4-Flash`),
  `AUDIO_PROXY_BASE_URL`. Matching commented `op://` entries + derivation doc added to
  `apps/api/.env.local.tpl`.
- **`HERMES_SESSION_KEY` default resolved** to
  `agent:main:slack:group:C0ASRUD7K1U:U0AS54FURPE`. The Slack user id `U0AS54FURPE` was
  resolved live via Slack `auth.test` using `op://common/slack/USER_TOKEN` (account
  `tkrumm`); the channel id `C0ASRUD7K1U` (#hermes group) is from the PRD.
- **Drizzle schema** (`apps/api/src/db/schema.ts`): `hermes_thread` + `hermes_message`
  with text PKs (app-generated via `createIdGenerator` in Group 2), `parts jsonb
$type<MessageParts>` (= `UIMessagePart<UIDataTypes, UITools>[]` from `ai`), `payload
jsonb $type<MessagePayload>`, FK `thread_id → hermes_thread` (cascade), and index
  `idx_hermes_message_thread_created (thread_id, created_at)`. Exported payload types:
  `AudioRef`, `Attachment` (text-only for v1), `ToolEvent`, `MessagePayload`.
  Migration generated: `drizzle/0009_friendly_mandarin.sql`.
- **Elysia route stubs**: `apps/api/src/routes/hermes.ts` (`GET /hermes/health`) and
  `apps/api/src/routes/ai.ts` (`GET /ai/v1/models` → empty OpenAI-shaped list), mounted
  in `index.ts` after `authGuard`.
- **OpenAPI taxonomy** expanded by two tags — `Hermes Chat` and `AI Gateway` — in
  lockstep across `src/index.ts` (`documentation.tags` + `/` discovery list) and the
  `apps/api/.claude/rules/openapi.md` enum table (now twelve tags), as the rule requires.
- **Dashboard route stub**: `apps/dashboard/src/routes/hermes-chat.tsx` (Mantine
  placeholder, no chat logic) + a new "Assistant" nav section in `__root.tsx`.

### Deviations from prompt

- **AI SDK pinned to v5, not the latest v6.** As of 2026-06-08 the latest is `ai@6.x` /
  `@ai-sdk/react@3.x`. The PRD locks "Vercel AI SDK v5" and its entire transport design
  (`createUIMessageStream`, `useChat`, `DefaultChatTransport`, `prepareSendMessagesRequest`,
  transient data parts) was researched/validated against v5. Honoring the locked decision
  keeps Groups 2–6 prescriptions valid. **Future:** a v6 migration is a deliberate later
  task, not a scaffold-time jump.
- **`remark-directive@4`, not the PRD's "v3".** v4.0.0 is the current release and is the
  one compatible with the `react-markdown@10` / unified 11 / micromark stack also pulled
  in by `remark-gfm@4`. Mixing in v3 would fight the shared unified version.
- **`rehype-harden` / `rehype-sanitize` not installed yet.** They're listed in the
  research set but not in Group 1's explicit dependency list, and sanitization lands in
  Group 6. Deferred to keep Group 1 scoped. Note: confirm `rehype-harden` actually exists
  on npm when Group 6 starts (it was referenced but not version-verified here).
- **Nav placement.** Added a dedicated "Assistant" section rather than folding Hermes Chat
  into "Work" (which is IU-work-specific) or "System" (plumbing). Set `mobile: false` for
  now to avoid crowding the 4-item mobile bottom-nav; revisit in Group 5.

### Gotchas & surprises

- **`bun add --exact 'pkg@^5'` does NOT pin exact** — it preserves the caret range spec
  you passed. To honor the "pin exact" rule the resolved versions had to be written back
  into both `package.json` files by hand, then `bun install` re-run (lockfile unchanged).
- **`bun run --cwd <relative>` is relative to the Bash tool's persisted CWD**, which is not
  guaranteed to be the repo root between calls — use absolute paths for `--cwd`.
- **Bun release-age cooldown is 3 days** (`~/.bunfig.toml minimumReleaseAge=259200`); the
  resolved versions (e.g. `ai@5.0.196`, 2026-06-04) are all past it.
- **React peer check:** `@ai-sdk/react@2` needs `^18 || ~19.0.1 || ~19.1.2 || ^19.2.1`;
  the repo resolves React to 19.2.14 → satisfied.

### Security notes

- No bearer/token values committed. `HERMES_API_KEY` etc. are optional empty-default env
  vars; real values live in `op://vps/argo/*` (Group 0).
- The resolved Slack user id (`U0AS54FURPE`) and #hermes channel id (`C0ASRUD7K1U`) are
  workspace identifiers, not secrets — they form the documented `HERMES_SESSION_KEY`
  default and were already present (channel) in the committed PRD.
- Both stub routes mount **after** `authGuard`, so they require `Authorization: Bearer
<API_SECRET>` (verified: the existing m365 auth-surface test pattern applies).

### Tests added

- None. Group 1 is foundation-only ("compiles, no behavior"); behavior + tests start in
  Group 2. The existing suite is unchanged.

### Validation result

- `bun run lint` ✓ (0 errors; 20 pre-existing warnings; theme guard clean)
- `bun run format:check` ✓
- `tsc` typecheck ✓ for api, dashboard (incl. `tsr generate`), charts
- `bun run --cwd apps/dashboard build` ✓
- `bun test --cwd apps/api`: **136 pass / 12 fail** — the 12 failures are **pre-existing
  and environmental**, not caused by this group. Verified by stashing all of this group's
  `apps/api/src` + `drizzle` changes and re-running: identical 136/12. Root cause is a
  local-DB ownership error (`must be owner of index uq_usage_source_sourceid`) thrown by an
  existing migration during `runMigrations()` at app boot — the local `argo` role doesn't
  own that index. Not a Hermes-table issue.

### Future improvements

- **Pre-existing test failures** (`uq_usage_source_sourceid` ownership) should be fixed in
  the local dev DB (re-provision via `make postgres-setup`, or `db:sync` to reset the
  `argo` schema to prod shape) so later API groups validate against a green baseline.
- Confirm Traefik does not buffer `/api/hermes/chat` before Group 2 ships streaming (PRD
  E2E adjustment #7).
- Re-evaluate the AI SDK v5 → v6 migration as a standalone task once the core chat is QA'd.

## Group 2: Hermes chat proxy + persistence

### What was implemented

- **`POST /hermes/chat`** (`apps/api/src/routes/hermes.ts`) — streams a Vercel-AI-SDK
  `UIMessageStream` to the client while proxying to Hermes `/v1/chat/completions` over
  Tailscale. Built with `createOpenAICompatible` → `streamText` →
  `writer.merge(result.toUIMessageStream())` inside `createUIMessageStream`, returned via
  `createUIMessageStreamResponse`. Only the **new turn** is forwarded (Hermes holds
  history); session continuity via `X-Hermes-Session-Id`, long-term memory via
  `X-Hermes-Session-Key`. The Hermes bearer is injected server-side by the provider and
  never reaches the client.
- **Raw-SSE tool-progress tap** (`apps/api/src/lib/hermes-sse.ts`, `filterToolProgress`).
  Rather than a naive `body.tee()`, the proxy passes a **custom `fetch`** to the provider
  that runs the upstream SSE through a filtering `ReadableStream`: `hermes.tool.progress`
  events are peeled off and handed to a callback (→ written as **transient**
  `data-toolProgress` parts), and every other event is re-emitted verbatim to the SDK
  branch. This is critical — see Gotchas.
- **No-buffer plumbing:** `X-Accel-Buffering: no` on the response; `server?.timeout(request, 0)`
  to disable Bun's idle timeout for the streaming connection. `content-encoding`/`content-length`
  are stripped when re-wrapping the filtered upstream body so the SDK doesn't try to
  re-decompress it.
- **Persistence on `onFinish`** (`persistTurn`): writes the user + assistant `UIMessage`s
  verbatim to `hermes_message` (server-generated `msg_…` ids via `createIdGenerator`), with
  any tapped tool events stashed in the assistant row's `payload.toolEvents` (not the
  transcript). A `db.transaction` also bumps the thread's `updated_at`. Aborted streams
  persist the assistant row with `status: 'interrupted'`.
- **`ensureThread`**: a chat turn upserts its thread so the message FK holds and Group 2 is
  self-contained (Group 4 adds the richer read CRUD + titling). An existing thread's stored
  `session_id` wins over any `sessionId` in the body; a new thread generates `thr_…`/`ses_…`
  ids and uses `sessionKey` (body override → env `HERMES_SESSION_KEY`).
- **`GET /hermes/health`** upgraded from the Group 1 static stub to a real upstream ping
  (derives `/health` from the base URL origin). Returns `degraded` (never throws) when
  Hermes is unconfigured/unreachable so the dashboard can show a soft offline state.
- **Mock seam:** `createHermesRoutes(overrides)` injects `{ baseURL, apiKey, sessionKey,
model, fetchImpl }`. `hermesRoutes` is the env-wired default; tests mount a variant with a
  fake Hermes `fetchImpl`. No live Mac Mini in the loop.
- **Env:** added `HERMES_MODEL` (default `'hermes'`) — the OpenAI `model` field Hermes
  maps/ignores. Documented that `HERMES_BASE_URL` must include the `/v1` path prefix.

### Deviations from prompt

- **Filter, don't tee.** The prompt says "tap the raw upstream SSE". A literal `tee()` would
  feed the custom `hermes.tool.progress` `data:` frames into the AI SDK's OpenAI parser,
  which would either error or mis-parse them (they have no `choices`). So the tap **filters**
  the custom events out of the SDK-bound branch instead of duplicating the whole stream. Same
  outcome (transient parts injected), but safe for the SDK. This resolves the PRD's flagged
  risk "AI SDK ↔ Hermes custom-event tap (validate early)".
- **Request body shape.** Designed `{ threadId?, sessionId?, sessionKey?, messages: UIMessage[] }`
  with `messages` left opaque to Zod (`z.array(z.unknown())`) — the AI SDK validates parts
  downstream, and the elysia-zod rules warn against heavy nested unions in route schemas. The
  Group 5 client will use `useChat` + `prepareSendMessagesRequest` to post only the new turn
  into this shape.
- **No compression to disable.** The prompt says "disable compression on the route", but the
  app mounts no compression plugin, so there was nothing to turn off (noted for the future).

### Gotchas & surprises

- **`createOpenAICompatible({ fetch })` typing.** `FetchFunction` is `typeof globalThis.fetch`,
  which includes `preconnect`. Our middleware (and `tracedFetch`) omit it, so a local
  `FetchImpl` type is used internally and widened with `as typeof fetch` only at the provider
  boundary.
- **`exactOptionalPropertyTypes` is on.** Zod `.optional()` yields `prop?: T | undefined`, which
  is _not_ assignable to a hand-written `prop?: T`; helper param types had to spell out
  `| undefined`. Also forced dropping the explicit `: Elysia` return annotation on the route
  factory (the annotation's default `prefix: ""` mismatched the real `"/hermes"`).
- **The environmental DB blocker is real and unfixable in-loop.** `runMigrations()` throws
  `must be owner of index uq_usage_source_sourceid` — migration 0004's `DROP INDEX` fails
  because `usage_record`'s indexes in the shared local DB are owned by `jkrumm`, not `argo`,
  and the journal only records 4 of 9 migrations. The superuser role needs a password not
  available in the headless loop (op/Touch ID), so I could not re-provision. Workaround: the
  Hermes test applies **only** the idempotent 0009 migration directly (read from the SQL file,
  split on `--> statement-breakpoint`) as the `argo` role, which owns the schema. No drift, no
  dependence on the broken chain. Full suite: **142 pass / 12 fail** — the 12 are the
  documented pre-existing failures (Group 1 baseline was 136 pass / 12 fail; my 6 tests all
  pass, no new failures).
- **`onFinish` timing.** It runs after the stream source completes; the persistence test drains
  the response body (`await res.text()`) then polls the DB briefly (`waitFor`) to avoid a
  finalize race.

### Security notes

- The Hermes bearer (`HERMES_API_KEY`) is added by the provider to the **upstream** request
  only; a test asserts it never appears in client-visible stream output and that it _is_ sent
  upstream as `Authorization: Bearer …` alongside the session headers.
- `/hermes/chat` mounts after the global `authGuard` in `index.ts`, so callers still need
  `Authorization: Bearer <API_SECRET>`. Tool-progress events are **transient** (streamed, not
  persisted); the verbatim transcript stores tool events only in `payload`, never inline.
- An existing thread's `session_id` cannot be overridden by the request body (prevents a
  caller from redirecting an existing thread's Hermes session).

### Tests added

`apps/api/src/routes/hermes.test.ts` (6 tests, mocked Hermes via injected `fetchImpl`):
streams assistant deltas + injects a `data-toolProgress` part; bearer absent from client
output but present (with session headers) upstream; user+assistant turn persisted verbatim
with `Hello world` reconstructed from parts and the tool event in `payload`; existing-thread
`session_id` reuse; `/hermes/health` ok-vs-degraded.

### Future improvements

- **Fix the local dev DB ownership** (re-provision via `make postgres-setup` or `db:sync`)
  so later API groups can use `runMigrations()` in `beforeAll` and validate against a green
  baseline — the 0009-only workaround is a loop-local stopgap, not a pattern to copy.
- **Verify the real Hermes `model` id** (`HERMES_MODEL`) and that `HERMES_BASE_URL` carries
  `/v1` during manual E2E; the default `'hermes'` is a guess (Hermes likely ignores it).
- **Tool-event/onFinish race:** the detached SSE filter pushes into a shared `toolEvents`
  array read by `onFinish`. In practice the filter completes before finish, but a stricter
  design would await the tap. Acceptable since `payload.toolEvents` is non-essential.
- Confirm Traefik does not buffer `/api/hermes/chat` in prod (still-open PRD E2E item #7).

## Group 3: General AI gateway (/ai/v1/\*)

### What was implemented

- **`apps/api/src/routes/ai.ts`** — the Group 1 stub (models-only) replaced by a full
  OpenAI-compatible gateway, all thin proxies that inject the upstream bearer server-side
  and stream the upstream response straight back:
  - `POST /ai/v1/chat/completions` → DeepSeek v4 Flash via the LiteLLM EU bridge. Defaults
    `model` to `DEEPSEEK_MODEL` (body `model` wins); supports non-stream (default) and
    `stream:true` SSE through the same passthrough path. Returns the upstream OpenAI shape.
  - `POST /ai/v1/audio/transcriptions` → audio-proxy STT. Multipart in: Elysia parses the
    form, the handler rebuilds a `FormData` (File fields stay `Blob`) and forwards it
    (fetch sets the multipart boundary; we never set content-type). Response verbatim.
  - `POST /ai/v1/audio/speech` → audio-proxy TTS. JSON in (`model`/`input`/`voice`/
    `response_format`), binary audio out (`audio/mpeg` fallback content-type).
  - `GET /ai/v1/models` → advertises the configured DeepSeek model (`owned_by:
deepseek-eu-bridge`).
- **`aiComplete(prompt, opts)`** exported from the same module — the in-process seam Group 4
  titling imports (no HTTP hop). Non-stream DeepSeek call, returns the assistant text;
  supports `system`/`model`/`temperature`/`maxTokens` and `deps` injection for tests.
- **Injectable deps** mirror `hermes.ts`: `createAiRoutes(overrides)` + `aiRoutes =
createAiRoutes()`; `AiRouteDeps { deepseekBaseURL, deepseekApiKey, deepseekModel,
audioBaseURL, audioApiKey, fetchImpl }`. Tests point `fetchImpl` at a fake upstream.
- **`apps/api/src/lib/auth-guard.ts`** — extracted the global Bearer `authGuard` out of
  `index.ts` into a shared module (verbatim logic + the `as:'scoped'`/`onTransform`
  rationale comment). `index.ts` now imports it; the unused `env` import was dropped. This
  lets `ai.test.ts` exercise the _real_ guard for the 401 contract instead of duplicating it.
- **Env:** added `AUDIO_PROXY_API_KEY` (optional bearer the audio-proxy gates on) and
  documented that `DEEPSEEK_BASE_URL` / `AUDIO_PROXY_BASE_URL` both include the `/v1` path
  prefix (matching `HERMES_BASE_URL`). `.env.local.tpl` updated with the same notes.

### Deviations from prompt

- **All upstream base URLs include `/v1`** (consistent with `HERMES_BASE_URL` from Group 2).
  So the handlers append `/chat/completions`, `/audio/transcriptions`, `/audio/speech`. The
  audio-proxy `endsWith`-matches its routes regardless of a `/v1` prefix (verified in its
  `src/index.ts`), so `<base>/v1/audio/...` works against it.
- **Extracted the auth guard** rather than replicating it in the test or importing the full
  `app` (importing `index.ts` runs `await runMigrations()` + `.listen(4000)` — unwanted in
  tests, and the migration chain is environmentally broken in the loop, see Group 1/2). The
  extraction is behavior-preserving and gives the test the production guard.
- **Streaming is a single passthrough path**, not a separate code branch — returning
  `new Response(upstream.body, …)` handles both JSON and SSE, with `X-Accel-Buffering: no`
  set unconditionally (harmless for non-stream).

### Gotchas & surprises

- **Elysia parses `multipart/form-data` even without a body schema** — `body` arrives as a
  plain object with File fields as `File`/`Blob`. Confirmed empirically by the STT test
  (`forwarded.get('file')` is a `Blob`). No `z.instanceof(File)` / `z.file()` body schema is
  needed (which would also risk `z.toJSONSchema` / elysia-zod degradation per the project's
  Zod rules), so the transcription route declares no body schema and stays a faithful
  passthrough of the full OpenAI field set.
- **`BodyInit` is not in the API tsconfig's lib set** (Bun types, no DOM lib). Used
  `RequestInit['body']` for the captured-request type instead.
- **oxlint `eqeqeq`** rejects `value != null`; spelled out `value !== null && value !==
undefined` in the FormData rebuild.
- The 12 pre-existing `runMigrations()` failures (`must be owner of index
uq_usage_source_sourceid`) persist — the gateway tests are DB-free (pure proxy), so they
  add 9 green tests on top of the Group 2 baseline (142→151 pass, 12 fail unchanged).

### Security notes

- The DeepSeek and audio-proxy bearers are injected on the **upstream** request only; tests
  assert the keys never appear in the client-visible response (`text` not containing
  `DEEPSEEK_KEY`; STT JSON not containing `AUDIO_KEY`). When a key env is empty, no
  `Authorization` header is sent at all (the audio-proxy treats no-key as auth-disabled).
- All `/ai/v1/*` routes mount after the global `authGuard` in `index.ts`; `ai.test.ts`
  verifies 401 without a bearer and 200 with `API_SECRET` through the same guard.
- Routing chat to the EU bridge base URL is the GDPR guarantee regardless of the `model`
  field — a test pins the upstream URL to the configured EU base.

### Tests added

`apps/api/src/routes/ai.test.ts` (9 tests, mocked upstreams, DB-free): auth 401/200 via the
real guard + model listing; chat round-trip pinned to the EU base with default-model
injection and bearer-not-leaked; body model override; 503 when the bridge is unconfigured;
STT multipart forwarded with `file`/`model` intact + audio key absent; TTS JSON→audio bytes;
`aiComplete()` returns assistant text with correct system/user message ordering + `stream:
false`, and throws when unconfigured.

### Future improvements

- **Verify the real `DEEPSEEK_BASE_URL` / `AUDIO_PROXY_BASE_URL` path conventions** during
  Group 0 / manual E2E — the loop assumes both carry `/v1`. If the LiteLLM bridge is mounted
  at root, drop the `/v1` from the configured value (the `joinUrl` append stays correct).
- **STT/TTS model defaults:** the gateway passes the client's `model` straight through (no
  default injected for audio). Group 8's voice-in / read-aloud should decide whether to pin
  a default STT model (e.g. `gpt-4o-transcribe`) and TTS voice server-side.
- **No upstream timeout/cancel wiring** on the gateway proxies (unlike `/hermes/chat`'s
  `timeout(req,0)`); fine for short titling calls, revisit if long audio synth needs it.

## Group 4: Read CRUD + DeepSeek titling

### What was implemented

Extended `apps/api/src/routes/hermes.ts` (the guarded plugin from Group 2) with
the read side, auto-titling, and interrupted-message handling:

- `POST /hermes/threads` — create a thread, minting a fresh `session_id` and
  defaulting `session_key` to the configured `HERMES_SESSION_KEY` (overridable).
  Returns the row.
- `GET /hermes/threads` — list threads, pinned-first then `updated_at` desc.
  Pagination (`page`/`limit`) + a `status` filter (`active` default / `archived`
  / `all`); excludes archived by default. `{ data, total }` shape.
- `GET /hermes/threads/:id/messages` — verbatim, chronologically ordered
  transcript; 404 if the thread is missing.
- `PATCH /hermes/threads/:id` — minimal rename / pin / archive. Archiving stamps
  `archived_at` + sets `status='archived'`; unarchiving clears both. Does not
  touch `updated_at` (that tracks message activity, not metadata edits). 404 if
  missing.
- **Auto-titling** — a new injectable `generateTitle` dep (defaults to a
  `aiComplete` DeepSeek-v4-Flash call) fired **fire-and-forget** from the proxy's
  `onFinish` after a non-aborted turn. `titleThreadIfNeeded` reads the first
  user+assistant exchange, generates a title, and writes it under an
  `isNull(title)` guard (idempotent / no clobber). Never awaited → never delays
  the stream.
- **Interrupted handling** — the Group 2 `aborted → status:'interrupted'` mapping
  is now exercised. `isAborted` flips when streamText emits an `abort` chunk on
  client disconnect; the partial assistant message persists as `interrupted`.

### Deviations from prompt

- **Touched Group 2's `persistTurn`** to stamp an explicit, per-index
  `created_at` (`new Date(baseMs + i)`), instead of relying on the column
  default. A single transaction's `now()` is identical for every row, so the
  user→assistant order within a turn was otherwise non-deterministic on read —
  which would break "fetch messages reproduce it verbatim". Minimal change,
  directly in service of Group 4's read correctness. Transcript reads order by
  `(created_at, id)`.
- **`generateTitle` is an injected dep**, not a direct `aiComplete` import at the
  call site, so titling tests run against a stub with no live DeepSeek bridge.
  The default wires the real `aiComplete` (Group 3 seam, no HTTP hop).
- Titling is gated on `!isAborted` — an interrupted turn has no complete
  assistant message worth titling from.

### Gotchas & surprises

- **`createIdGenerator` uses `-` as the separator**, so generated ids are
  `thr-…`/`ses-…`/`msg-…`, not `thr_…`. (The Group 2 tests only ever passed
  manual `thr_test_*` ids, so this surfaced for the first time when asserting the
  generated id format.)
- **Abort is observed lazily by streamText**: it only emits the `abort` UI chunk
  the next time its upstream `reader.read()` resolves (or throws an AbortError)
  — see `ai/dist/index.js` ~L4955. A fake upstream that emits partial content
  then _parks_ (never resolves the read) hangs forever — the abort is never seen
  and the test times out. Fix: the fake keeps trickling content deltas every
  ~10ms (never sending a finish), so the read loop stays live and detects the
  aborted signal. `controller.abort()` is fired ~30ms in via the request signal.
- **Response enum vs DB text**: `status`/`role` are plain `text` columns (typed
  `string`), but the response schemas narrow them to `z.enum` literal unions for
  a richer OpenAPI contract. Elysia's strict return-type inference rejects the
  `string`-typed rows against the enum, so each return is asserted to a
  `z.infer<typeof …Schema>` alias (`ThreadResponse`/`MessageResponse`). Runtime
  is still validated by Elysia. Kept `z.enum` (not `z.string()`) deliberately —
  the elysia-zod rule's union-serialization caveat is about `z.union([literal…])`,
  not `z.enum`.

### Security notes

- All new routes are mounted under the global `authGuard` in `index.ts` (via
  `hermesRoutes`); the bare plugin is also used in tests without the guard, same
  as Group 2. No upstream secrets are involved in the read paths.
- Titling sends only the first user+assistant text (sliced to 500 chars each) to
  the EU DeepSeek bridge via the existing `aiComplete` seam — same GDPR routing
  guarantee as Group 3.

### Tests added

`apps/api/src/routes/hermes.test.ts` grew from 4 to 15 tests (mocked upstreams,
DB via the direct 0009 apply from Group 2):

- titling: fresh thread titled from the first exchange via a mocked titler (also
  exercises the quote-strip / whitespace-collapse cleanup); already-titled thread
  is **not** retitled (titler not called).
- interrupted: client abort mid-stream persists the partial assistant message as
  `status:'interrupted'` while the user message stays `complete`.
- read CRUD: create (minted `session_id`, defaulted `session_key`); list
  (pinned-first → newest, archived excluded, `?status=all` includes it);
  transcript in verbatim `[user, assistant]` order with reconstructed text; 404
  for a missing thread's transcript and a missing-thread PATCH; PATCH rename +
  pin, then archive/unarchive round-trip.

The 12 pre-existing `runMigrations()` failures (`must be owner of index
uq_usage_source_sourceid`, an environmental role-ownership issue in the shared
dev DB — see Group 1) persist unchanged; `hermes.test.ts` is unaffected (it
applies migration 0009 directly). Suite: 160 pass / 12 fail (was 151/12 → +9 net
new green from the rebuilt hermes test file).

### Future improvements

- **Titling trigger is best-effort and in-process.** If the API restarts between
  the turn finishing and the title write, the thread stays untitled until the
  next turn (which re-checks `title == null`). Acceptable for v1; a small backfill
  pass could title orphaned threads.
- **No cursor pagination on the transcript** — `GET /threads/:id/messages`
  returns the full thread. Fine for personal-scale threads; revisit if threads
  grow large.
- **Title language/length** depends on the DeepSeek prompt; `cleanTitle` caps at
  80 chars and strips wrapping quotes, but the model could still return prose.
  Group 7's output-shaping work could tighten this if needed.
- **`updated_at` is bumped only on a chat turn**, not on PATCH. If the UI wants
  pin/rename to resurface a thread, revisit the ordering key.
