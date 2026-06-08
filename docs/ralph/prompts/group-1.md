# Group 1: Foundation & scaffolding

## What You're Doing

Lay the foundation for Hermes Chat so later groups have stable seams. Install +
pin dependencies, wire env/config, create the Drizzle schema + migration, stub the
Elysia route modules and the dashboard route. **No behavior yet** — the repo must
compile and the existing test suite must still pass. This group has no pre-group
validation gate; leave everything green.

## Research & Exploration First

1. Read `docs/HERMES-CHAT-PRD.md` (esp. "Industry-pattern research" + persistence
   schema) and `apps/api/CLAUDE.md` (DB, migrations, adding a route).
2. Read `apps/api/src/index.ts` (how `authGuard` + routes mount), an existing route
   (`apps/api/src/routes/slack.ts`), the Drizzle schema dir, and `apps/api/src/env.ts`.
3. Read `apps/dashboard/src/routes/m365-explorer.tsx` (route pattern) + the nav
   definition, and `apps/dashboard/src/lib/eden.ts` / `auth.ts`.
4. Verify current APIs/versions before adding deps (Context7/WebSearch): `ai`,
   `@ai-sdk/react`, `@ai-sdk/openai-compatible`, `react-markdown`, `remend`,
   `remark-gfm`, `remark-directive`, `mermaid`, `vega`, `vega-lite`, `vega-embed`,
   `rehype-harden`, `rehype-sanitize`.

## What to Implement

### 1. Dependencies (pinned, exact)

Add to the correct workspace `package.json` (API vs dashboard) and `bun install`.
Pin exact versions. Respect the release-age cooldown. Server-side AI SDK
(`ai`, `@ai-sdk/openai-compatible`) → `apps/api`; client (`@ai-sdk/react`,
`react-markdown`, `remend`, remark/rehype, mermaid, vega) → `apps/dashboard`.

### 2. Env / config (additive, OPTIONAL — tests must boot without these)

In `apps/api/src/env.ts` add **optional** vars (so the app boots in test/CI without
them): `HERMES_BASE_URL`, `HERMES_API_KEY`, `HERMES_SESSION_KEY`,
`DEEPSEEK_BASE_URL`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` (default
`DeepSeek-V4-Flash`), `AUDIO_PROXY_BASE_URL`. Add matching commented entries to
`apps/api/.env.local.tpl` with their `op://` refs (leave actual provisioning to
Group 0 / Johannes). For `HERMES_SESSION_KEY`, document the default form
`agent:main:slack:group:C0ASRUD7K1U:<johannes_slack_user_id>` and resolve the Slack
user id (Slack `auth.test` via the existing client, or note how to fetch it) —
store the resolved value as the documented default.

### 3. Drizzle schema + migration

Add `hermes_thread` + `hermes_message` tables per the PRD:

```ts
// threads: id, session_id, session_key, title, status, pinned, archived_at, created_at, updated_at
// messages: id, thread_id (fk), role, parts jsonb $type<UIMessagePart[]>,
//           payload jsonb $type<MessagePayload>, status, created_at
// index (thread_id, created_at)
```

Define `MessagePayload` (audio refs `{url,title,durationMs}`, attachments, optional
tool events). Generate the migration (`bun run --cwd apps/api db:generate`).

### 4. Elysia route stubs

Create `apps/api/src/routes/hermes.ts` and `apps/api/src/routes/ai.ts` as Elysia
modules (prefixes `/hermes` and `/ai`), mounted in `index.ts` **after** `authGuard`.
A single placeholder `GET /hermes/health` (and `/ai` `GET /v1/models` returning an
empty list) is enough — real handlers land in Groups 2–3. Add OpenAPI tags
consistent with `apps/api/.claude/rules/openapi.md`.

### 5. Dashboard route stub

Create `apps/dashboard/src/routes/hermes-chat.tsx` (TanStack route) with a minimal
Mantine placeholder, and add a nav entry (follow the existing nav pattern). No chat
logic yet.

## Validation

```bash
bun run lint
bun run format:check
bun run --cwd apps/api typecheck
bun run --cwd apps/dashboard typecheck
bun run --cwd packages/charts typecheck
bun run --cwd apps/dashboard build
bun test --cwd apps/api        # existing suite must still pass (DATABASE_URL is exported)
```

## Commit

```
feat(hermes-chat): scaffold deps, env, drizzle schema, route + page stubs
```

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 1
```
