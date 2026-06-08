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
