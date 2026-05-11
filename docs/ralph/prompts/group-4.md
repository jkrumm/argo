# Group 4: `apps/dashboard` scaffold

## What You're Doing

Create `apps/dashboard` as a fresh Vite + React 19 + Mantine v9 app with file-based TanStack Router, theme toggle, sidebar, and empty route stubs for the two pages. No business logic yet — that lands in Groups 4, 5, 8, 9. After this group, `bun --cwd apps/dashboard dev` boots a working shell on `:5173` with the sidebar visible in both color schemes. Legacy `packages/dashboard` is **not** run locally — visual reference is the live production deploy.

This group can run in parallel with Groups 1 and 2.

---

## Required Reading

1. **The PRD section** for this group: `docs/MANTINE-MIGRATION-PRD.md` lines 644-654 (Group 3).
2. The **Architecture / Workspace layout** + **Provider tree** + **Data flow** sections of the PRD.
3. Mantine v9 quickstart: https://mantine.dev/getting-started/ and the Vite-specific guide: https://mantine.dev/getting-started/#vite. Verify the current install + provider pattern via `/research` before writing imports.
4. TanStack Router file-based routing: https://tanstack.com/router/latest/docs/framework/react/guide/file-based-routing and the `@tanstack/router-plugin/vite` integration.
5. Legacy sidebar shape: `packages/dashboard/src/App.tsx` (resources + menu items).
6. `~/SourceRoot/dotfiles/rules/tanstack-router.md` — file-based routing conventions.
7. `~/SourceRoot/dotfiles/rules/react-best-practices.md` — bundle, rerender, async rules.

---

## What to Implement

### 1. `apps/dashboard/package.json`

Dependencies (verify versions via `/research`):

- `react`, `react-dom` (^19)
- `@mantine/core`, `@mantine/hooks`, `@mantine/form`, `@mantine/notifications`, `@mantine/modals`, `@mantine/dates`
- `@tabler/icons-react`
- `@tanstack/react-router`, `@tanstack/react-router-devtools`
- `@tanstack/react-query`, `@tanstack/react-query-devtools`
- `@elysiajs/eden` (Group 4 wires it; install now)
- `zustand`
- `zod`
- `date-fns`

devDeps:

- `vite`, `@vitejs/plugin-react`
- `@tanstack/router-plugin` (for file-based routing)
- `typescript`

Scripts:

```json
"dev":       "vite --port 5173 --strictPort",
"build":     "vite build",
"preview":   "vite preview --port 5173 --strictPort",
"typecheck": "tsc --noEmit"
```

### 2. `apps/dashboard/vite.config.ts`

Plugins: `react()`, `TanStackRouterVite({ target: 'react', autoCodeSplitting: true })`. Port 5173, `strictPort: true`. Path alias `@argo/api` → `../api/src` (or the workspace alias the api uses), `@argo/charts` → `../../packages/charts/src` (the package is created in Group 5; the alias can resolve to an empty stub now or just be added in Group 5 — your call, document in notes).

React Compiler + OTLP proxy are added in later groups (10 and 7 respectively). Do not add them here.

### 3. `apps/dashboard/index.html`

Standard Vite shell. Include `<ColorSchemeScript />` insertion via Mantine convention (https://mantine.dev/theming/color-schemes/). Set the document title to `Argo`.

### 4. `apps/dashboard/src/main.tsx`

Provider tree (outer → inner):

```
<MantineProvider defaultColorScheme="dark">
  <Notifications />
  <ModalsProvider>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </ModalsProvider>
</MantineProvider>
```

QueryClient stub here is fine — Group 4 moves it to `src/lib/query-client.ts`.

**Reserve the very first line of this file for `import './lib/hyperdx'`** — Group 7 fills it in. Add a placeholder comment and the import to a stub file that exports nothing.

### 5. Route structure

File-based routing under `apps/dashboard/src/routes/`:

```
routes/
├── __root.tsx          # sidebar + theme toggle + <Outlet />
├── index.tsx           # redirect to /garmin-health
├── garmin-health.tsx   # empty stub
└── strength-tracker.tsx # empty stub
```

Generated route tree goes to `apps/dashboard/src/routeTree.gen.ts` (add to `.gitignore` or commit — pick one, document).

`__root.tsx` sidebar:
- Logo / title.
- Mantine theme toggle (`useMantineColorScheme()`).
- NavLinks: **Garmin Health**, **Strength Tracker** (active routes). **Docker**, **Monitoring**, **Tasks** (disabled placeholders with a tooltip "coming soon").
- Use Mantine `AppShell` with a fixed left sidebar, responsive collapse on mobile (`AppShell.Navbar` collapsed prop).

### 6. `apps/dashboard/src/lib/hyperdx.ts` (placeholder)

```ts
// Filled in by Group 7. Keeping the file so main.tsx's first import resolves.
export {};
```

### 7. `apps/dashboard/tsconfig.json`

`strict: true`, `jsx: "react-jsx"`, `moduleResolution: "bundler"`, path aliases. Do not extend `tsconfig.base.json` yet — that arrives in Group 10. Use Vite's `tsconfig.app.json` + `tsconfig.node.json` split if the Vite template you scaffold from prefers it.

### 8. `apps/dashboard/Dockerfile` + `apps/dashboard/nginx.conf`

Match the production shape used by `packages/dashboard/Dockerfile` (multi-stage build, nginx serving `dist/`). The deploy.yml swap happens in Group 11; for now this Dockerfile sits unused.

### 9. `apps/dashboard/.gitignore`

`node_modules/`, `dist/`. Add `routeTree.gen.ts` if you chose to gitignore it.

### 10. `apps/dashboard/CLAUDE.md` (minimal)

A 20-line stub: "Vite + React 19 + Mantine v9 + TanStack Router (file-based) + TanStack Query + Eden Treaty + Zustand. Routes live in `src/routes/`. Sidebar in `src/routes/__root.tsx`. Theme toggle via Mantine's `useMantineColorScheme()`." Group 12 does the polish.

---

## Validation

```bash
bun install
bun --cwd apps/dashboard typecheck
bun --cwd apps/dashboard build
bun run lint
bun run format:check

# Manual: bun --cwd apps/dashboard dev
# Visit http://localhost:5173 — sidebar renders, theme toggle works, both stubs route.
```

Verify in dev mode that:
- The page loads in dark mode by default.
- Theme toggle flips both Mantine + the `data-mantine-color-scheme` attribute.
- Both route stubs render their (empty) bodies.
- Disabled sidebar items do not navigate.
- Mobile breakpoint collapses the sidebar.

---

## Commit

```
feat(dashboard): scaffold apps/dashboard with vite + mantine v9 + tanstack router
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then output as the literal last line:

```
RALPH_TASK_COMPLETE: Group 4
```
