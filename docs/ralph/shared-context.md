# Argo — Hermes Chat Phase B — RALPH Shared Context

You are implementing **Phase B of Hermes Chat**: turn the working core chat into the
thread-first, Slack-style assistant in `docs/diagrams/ChatWireframe.svg` — rich inline
rendering of Hermes output (cards, **bundled+themed diagrams**, accents), a per-thread
title + summary + type badge feed, voice in/out, and attachments. Read this fully before
starting your group.

The authoritative product spec is `docs/HERMES-CHAT-PRD.md`. Phase A (the core chat) is
archived in `docs/migrations/hermes-chat-phase-a.md` — read it for what already exists and
the decisions that survived. This loop's groups are numbered 1–8 (fresh state); they map to
the handover's conceptual "Groups 7–11" in `docs/HERMES-CHAT-PHASE-B.md`.

---

## What Argo + Hermes Chat Is

Argo is Johannes Krumm's personal homelab dashboard + AI-agent API (Elysia + Bun + Postgres
on `:4000`; Vite + React 19 + Mantine v9 dashboard on `https://argo.test`). Hermes Chat is a
chat surface inside the dashboard that talks to the **Hermes agent core** over its
OpenAI-compatible API (Mac Mini, port 8642, over Tailscale). Argo proxies the stream, owns
the **verbatim transcript** in Postgres, and auto-titles threads with DeepSeek. Hermes holds
only compressed per-session agent state — **do not move persistence into Hermes**.

Phase A landed (Groups 1–6): a streaming Elysia proxy with a tool-progress tap, Postgres
thread/message persistence, DeepSeek auto-titling, a rich Mantine-native markdown renderer
(cards / accents), and an `/ai/v1/*` OpenAI-compatible gateway (DeepSeek chat + STT + TTS).
The diagram renderer shipped as a **CDN/iframe stopgap that Phase B replaces** (see Hard
Constraints).

---

## Repository Layout (Phase-B-relevant)

| Path                                       | What                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/routes/hermes.ts`            | Chat proxy, persistence (`persistTurn`), auto-titling (`titleThreadIfNeeded`, `deepseekTitle`), thread CRUD.  |
| `apps/api/src/routes/ai.ts`                | `/ai/v1/*` gateway: chat, `audio/transcriptions` (STT), `audio/speech` (TTS); `aiComplete()` in-process seam. |
| `apps/api/src/db/schema.ts`                | Drizzle schema. `hermesThread` / `hermesMessage` under `pgSchema('argo')`.                                    |
| `apps/api/drizzle/`                        | Generated, committed migration SQL.                                                                           |
| `apps/api/src/env.ts`                      | Zod env schema. `HERMES_*`, `DEEPSEEK_*`, `AUDIO_PROXY_*` groups (all optional/defaulted).                    |
| `apps/dashboard/src/features/hermes-chat/` | The chat feature (see file map below).                                                                        |
| `apps/dashboard/src/lib/queries/hermes.ts` | TanStack Query factory; `HermesThread` / `HermesMessage` frontend types.                                      |
| `packages/charts/src/`                     | visx primitives + the `VX.*` token / `--vx-*` CSS-var palette (`palette.ts`, `theme-vars.ts`, `tokens.ts`).   |

`apps/dashboard/src/features/hermes-chat/` files:
`chat-page.tsx` (responsive list+detail container — **replaced in Group 5**), `chat-view.tsx`
(thread loader/gate), `chat-conversation.tsx` (the `useChat` detail pane + composer),
`thread-list.tsx` (sidebar rows: title + pin + timestamp), `message-markdown.tsx` (the rich
renderer; intercepts ` ```card `/` ```mermaid `/` ```vega-lite ` fences in its `code`
component), `smart-card.tsx` (`parseCard` → Mantine cards), `diagram-frame.tsx` (**the
CDN/iframe diagram renderer — deleted in Group 4**), `remark-hermes-accents.ts` (inline
`:badge[]{}` + `==mark==`), `sanitize-schema.ts` (`hermesSanitizeSchema`, the rehype-sanitize
allowlist), `transport.ts`, `types.ts`.

---

## Tech Stack

| Concern            | Choice                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API                | Elysia + Bun + Postgres 18 + Drizzle + Zod + OTel                                                                                                                              |
| Dashboard          | Vite + React 19 (React Compiler) + Mantine v9 + TanStack Router/Query + Eden/AI-SDK v5                                                                                         |
| Chat streaming     | Vercel AI SDK v5 (`createUIMessageStream`, `useChat`, `@ai-sdk/openai-compatible`)                                                                                             |
| Markdown render    | `react-markdown` v10 + `remark-gfm`/`remark-directive` + `rehype-sanitize` + `rehype-harden`                                                                                   |
| Diagrams (Phase B) | Bundled `mermaid@11.15.0`, `vega@6.2.0`, `vega-lite@6.4.3` — already in `apps/dashboard/package.json`, currently **unused** (loaded from jsDelivr CDN in `diagram-frame.tsx`). |
| Charts/theme       | `@argo/charts` — `VX.*` token refs = `var(--vx-*)` CSS custom properties, redeclared per `[data-mantine-color-scheme]`.                                                        |

---

## Validation Commands

Run these **directly** — `DATABASE_URL` and `API_SECRET` are already exported into your
environment by the runner (pre-fetched from 1Password). **Do NOT wrap anything in `op run`**
and **do NOT use `bun test:api` / `bun db:migrate`** (those re-invoke `op` and will hang on
Touch ID in the autonomous loop). Use the underlying `bun` commands:

```bash
bun run lint                              # oxlint + scripts/check-theme.mjs (NO raw hex / off-palette)
bun run format:check                      # oxfmt
bun run --cwd apps/api typecheck          # tsc
bun run --cwd apps/dashboard typecheck    # tsc
bun run --cwd packages/charts typecheck   # tsc
bun run --cwd apps/dashboard build        # vite build
bun test --cwd apps/api                   # API suite vs LIVE local Postgres (:5432); upstreams mocked
```

Single test file while iterating: `bun test --cwd apps/api src/routes/hermes.test.ts`.
Generate a migration (no DB needed): `bun run --cwd apps/api db:generate`.

There is **no dashboard test harness** — frontend correctness is verified by
typecheck + build + manual QA. Never block a group on live Hermes/audio/DeepSeek; tests mock
all upstreams.

### DB migration discipline (READ — this breaks groups otherwise)

The shared **local dev Postgres is half-migrated**: the full `runMigrations()` / `bun
db:migrate` chain fails on an unrelated earlier migration (`0004`'s `DROP INDEX` on
`usage_record`, owned by a different role — documented in
`docs/migrations/hermes-chat-phase-a.md`). The Hermes tests work around this by applying
**only the Hermes migration SQL directly** in `beforeAll` via `client.unsafe()` (see
`apps/api/src/routes/hermes.test.ts`). Consequences for any group that changes the schema:

1. New migrations **MUST be idempotent**: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT
EXISTS`, etc. drizzle-kit does **not** emit `IF NOT EXISTS` by default — **hand-edit the
   generated SQL** to add it, mirroring the existing idempotent Hermes migration.
2. The Hermes test bootstrap currently applies only the older Hermes migration. **Extend the
   `beforeAll` direct-apply** (in `hermes.test.ts` and any new Hermes test file) to also apply
   your new migration file, so the new columns exist in the test DB.
3. Do **not** rely on `bun db:migrate` succeeding locally — verify via the tests.

---

## Hard Constraints (non-negotiable)

- **Diagrams: NO CDN, NO iframe, NO jsDelivr.** `diagram-frame.tsx` currently loads
  `mermaid` + `vega-embed` from `cdn.jsdelivr.net` inside a sandboxed iframe. This is
  **rejected**. Bundle the already-installed `mermaid` / `vega` / `vega-lite` packages and
  render diagrams **inline as React components**, themed through DESIGN.md tokens
  (`VX.*` / `--vx-*` CSS vars + Mantine). Contain XSS **without** the iframe origin boundary:
  mermaid `securityLevel: 'strict'`, **sanitize the LLM-supplied diagram source**, run Vega
  in **safe / interpreter mode (no expression `eval`)**. (Memory: `hermes-diagram-rendering`.)
- **DESIGN.md is law.** Read `DESIGN.md` (repo root) + `docs/MANTINE-THEMING.md` +
  `~/.claude/rules/visx-charts.md` before any UI work. All chrome + rendered components use
  Mantine v9 + the Blueprint palette/tokens. **No raw hex** — `scripts/check-theme.mjs` fails
  `bun run lint` on raw hex / `rgb()` / off-palette accents. Diagram/chart colors map to the
  `--vx-*` tokens, never library defaults.
- **Argo owns the transcript; Hermes owns compressed agent state.** Don't move persistence
  into Hermes.
- **`@elysiajs/openapi` + Zod v4 quirks** apply to any new route schema — see
  `apps/api/.claude/rules/elysia-zod.md` (use `z.enum` not literal unions in responses; ISO
  string dates; `z.coerce.number()` for query params).

### Out of scope for this loop

Getting **Hermes to _emit_** the `card`/`mermaid`/`vega-lite`/accent formats is **prompt/skill
work in the separate `hermes-agent` repo** (a different repo on the Mac Mini). RALPH runs in
`argo` and commits here only — **do not attempt cross-repo edits**. The renderer is ready; the
producer is a tracked manual task. Your summary/titling work (Group 2) IS Argo-side and in
scope.

---

## Research Before Implementing

1. Explore with Glob/Grep/Read — understand the existing pattern before writing.
2. Research unfamiliar library APIs (mermaid render API + `securityLevel`, vega/vega-lite
   `vega-embed` vs `compile()` + `View`, Mantine v9 components) with Context7 or
   Tavily/WebFetch. Never invent an API — the model's training is stale; verify versions.
3. Read the relevant existing file (e.g. `diagram-frame.tsx` for how theming colors are read,
   `hermes.ts` for the titling pattern) before replacing it.
4. The group prompt is direction, not prescription — use a better approach if you find one,
   but keep the hard constraints.

---

## Learning Notes

After completing each group, **always append** to `docs/ralph/RALPH_NOTES.md`:

```markdown
## Group N: <title>

### What was implemented

<1–3 sentences>

### Deviations from prompt

<what you changed and why>

### Gotchas & surprises

<library APIs, theming, sanitize, DB quirks>

### Security notes

<XSS containment decisions, sanitize allowlist changes, etc.>

### Tests added

<list of test files/functions>

### Future improvements

<deferred work, tech debt>
```

---

## Commit Format

Conventional commits, no AI attribution. Stage only the files you changed. Commit before
signaling completion.

```
feat(hermes-chat): <description>
```

**Use raw `git` only.** `git add <files>` + `git commit -m "..."`. **Do NOT invoke `/commit`,
`/pr`, `/check`, `/review`, `/ship`, or any slash-command skill** — they are interactive and
will silently no-op in headless mode, leaving the group uncommitted. **Do NOT `git push`** (a
pre-push hook blocks it; the loop commits locally only). If a group needs multiple logical
commits, run `git add <subset> && git commit` once per commit.

---

## Completion Signal

Output exactly one of these as the very last line (literal text, not in a code block):

```
RALPH_TASK_COMPLETE: Group N
```

If blocked by something unresolvable:

```
RALPH_TASK_BLOCKED: Group N - <one-sentence reason>
```
