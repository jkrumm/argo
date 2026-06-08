# Hermes Chat — RALPH Shared Context

You are implementing **Hermes Chat** — a thread-first, Slack/WhatsApp-style chat
surface inside the Argo dashboard that talks directly to the Hermes agent core over
its OpenAI-compatible API. **Read `docs/HERMES-CHAT-PRD.md` in full before starting
— it is the authoritative spec.** This file is the operating contract for the loop.

This is **Phase A (Groups 1–6): the core chat.** Groups 7–10 (output shaping,
audio, attachments, Slack feed) are a later loop — do not build them now.

---

## What Hermes Chat is (essentials)

- **Transport:** the dashboard talks to Hermes via an Elysia proxy. Server uses the
  **Vercel AI SDK v5** `@ai-sdk/openai-compatible` (bearer stays server-side) +
  `createUIMessageStream`; client uses `@ai-sdk/react` `useChat`.
- **Hermes is NOT the database.** It stores only compressed agent state per
  `X-Hermes-Session-Id`. **Argo owns the verbatim transcript** in Postgres
  (Drizzle): `threads` + `messages` (`parts` jsonb = AI SDK `UIMessage` parts;
  `payload` jsonb = audio refs / attachments / optional tool events).
- **Memory:** one thread = one `X-Hermes-Session-Id` (fresh id = fresh context);
  cross-thread memory via a constant `X-Hermes-Session-Key` (`HERMES_SESSION_KEY`).
- **Rendering:** `react-markdown` v10 + `remend` (streaming-safe) + **Mantine-native**
  component mappings (NOT Streamdown — no Tailwind). Hybrid syntax: fenced
  ` ```card ` / ` ```mermaid ` / ` ```vega-lite ` blocks + inline `remark-directive`
  accents. Mermaid/Vega run in a sandboxed `<iframe sandbox="allow-scripts">`.
- **General AI gateway** `/ai/v1/*`: DeepSeek v4 Flash (titling) + STT + TTS.

## Verified Hermes API contract (ground truth — do not re-derive)

- `POST /v1/chat/completions` (SSE), port `8642`, bearer `API_SERVER_KEY`.
- Headers: `X-Hermes-Session-Id` (thread continuity), `X-Hermes-Session-Key`
  (long-term memory scope).
- SSE: OpenAI chunks + a **custom** `event: hermes.tool.progress`
  (`{tool,emoji,label,toolCallId,status}`) — `@ai-sdk/openai-compatible` will NOT
  surface this; the proxy must tap the raw SSE and inject it as a **transient data
  part**.

---

## Repository layout

```
apps/api/          Elysia + Bun + Postgres + Drizzle + Zod + OTel
  src/index.ts       app composition; global authGuard (Bearer); route mounting
  src/routes/*.ts    one Elysia module per domain (slack.ts is a good reference)
  src/clients/*.ts   upstream clients (use lib/traced-fetch.ts → tracedFetch)
  src/db/ (drizzle)  schema + migrations (bun run --cwd apps/api db:generate)
apps/dashboard/    Vite + React 19 + Mantine v9 + TanStack Router/Query
  src/routes/*.tsx   flat TanStack routes (garmin-health.tsx, m365-explorer.tsx)
  src/lib/eden.ts    Eden Treaty client; src/lib/auth.ts useAuthStore (Bearer)
packages/charts/   theme-agnostic visx primitives (@argo/charts) — token approach
docs/HERMES-CHAT-PRD.md   the full spec
DESIGN.md                 visual-identity LAW (read it; it wins over habit)
docs/MANTINE-THEMING.md   Mantine v9 chrome theming method
```

## Tech stack

| Concern        | Choice                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| API            | Elysia + Bun, Drizzle ORM (Postgres), Zod, OTel (`tracedFetch`)                                                                                      |
| Dashboard      | React 19 + Mantine v9 + TanStack Router + TanStack Query v5 + Vite (React Compiler)                                                                  |
| Chat transport | Vercel AI SDK v5 (`ai`, `@ai-sdk/react`, `@ai-sdk/openai-compatible`)                                                                                |
| Rendering      | `react-markdown` v10 + `remend` + `remark-gfm` + `remark-directive`; `mermaid`, `vega`/`vega-lite`/`vega-embed`; `rehype-harden` + `rehype-sanitize` |
| Auth           | global `authGuard` Bearer (`API_SECRET`); prod is Tailscale-only                                                                                     |

## Validation commands

The runner runs the gate between groups (no DB/op needed):

```bash
bun run lint
bun run format:check
bun run --cwd apps/api typecheck
bun run --cwd apps/dashboard typecheck
bun run --cwd packages/charts typecheck
bun run --cwd apps/dashboard build
```

**Tests (API groups):** `DATABASE_URL` is already exported into your environment by
the runner (pre-fetched from 1Password). Run tests directly — **do NOT use
`op run` or `bun test:api`** (it wraps `op run` and will hang on Touch ID):

```bash
bun test --cwd apps/api                  # uses the exported DATABASE_URL
bun run --cwd apps/api db:generate       # after schema changes (then it auto-migrates on boot/test)
```

## Testing discipline (critical for this loop)

**Mock the upstreams.** Hermes (Mac Mini), the audio-proxy, and the DeepSeek bridge
are NOT reachable in the loop. Every test that would call them must use a **mock /
fake** (a local fetch stub or an injected client) so the loop self-validates
without live cross-machine services. Real end-to-end testing against live Hermes is
a manual step Johannes runs after the loop — never block a group on a live upstream.

## Research before implementing

1. Read `docs/HERMES-CHAT-PRD.md` + the relevant existing code (e.g. `slack.ts`
   for an Elysia route, `eden.ts`/`auth.ts` for the client, an existing `*.test.ts`).
2. For any library (AI SDK v5, react-markdown, remend, mermaid, vega) verify the
   **current** API with Context7 / WebSearch / WebFetch before using it — do not
   invent signatures. Pin exact versions; respect the bun release-age cooldown.
3. The group prompt is direction, not prescription — use a better approach if you
   find one, and record it in the notes.

## Design discipline

`DESIGN.md` is the law. All chrome + rendered components use Mantine v9 + the
Blueprint palette/tokens — **no raw hex** (a guard script enforces it: `bun run
lint` includes `check-theme.mjs`). Mermaid/Vega themes map to DESIGN.md CSS-var
tokens, not library defaults.

## Commit format (raw git only)

Conventional commits, no AI attribution. Stage only the files you changed; commit
before signaling completion.

```
feat(hermes-chat): <description>
```

**Never invoke interactive slash-skills** (`/commit`, `/pr`, `/check`, `/review`,
`/ship`) — they wait for confirmation that never comes in headless mode. Use raw
`git add <files> && git commit -m "..."`. Run validation via the underlying tools
(`bun run lint`, `bun test`), never `/check`.

**Never push.** A pre-push hook blocks it. Commit only.

## Learning notes

After completing each group, **always append** to `docs/ralph/RALPH_NOTES.md`:

```markdown
## Group N: <title>

### What was implemented

### Deviations from prompt

### Gotchas & surprises

### Security notes

### Tests added

### Future improvements
```

## Completion signal

Output exactly one of these as the very last line (literal text, not in a code block):

```
RALPH_TASK_COMPLETE: Group N
```

If genuinely blocked:

```
RALPH_TASK_BLOCKED: Group N - <one-sentence reason>
```
