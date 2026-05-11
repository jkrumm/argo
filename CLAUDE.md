# Argo — Project Configuration

## Workspace Layout

Workspaces: `apps/*` + `packages/*`

- `apps/api` — Elysia + Bun backend (`@argo/api`)
- `apps/dashboard` — Vite + React 19 + Mantine v9 frontend
- `packages/charts` — Theme-agnostic visx primitives (`@argo/charts`)

## Common commands

```bash
bun install                              # install all workspace deps

# API
bun --cwd apps/api run start             # start API on :4000
bun --cwd apps/api run db:migrate        # apply Drizzle migrations
bun --cwd apps/api run db:generate       # generate migration from schema changes
bun --cwd apps/api test                  # run all tests (needs DATABASE_URL + API_SECRET)
bun --cwd apps/api run typecheck

# Dashboard
bun --cwd apps/dashboard run dev         # start dashboard on :5173
bun --cwd apps/dashboard run typecheck

# Charts package
bun --cwd packages/charts run typecheck

# Root (all workspaces)
bun run lint                             # oxlint
bun run format:check                     # oxfmt
```

## Workspace-specific docs

- `apps/api/CLAUDE.md` — DB setup, migrations, test commands, OTel env vars
- `apps/dashboard/CLAUDE.md` — Route structure, page addition workflow, React Compiler
