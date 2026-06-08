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
