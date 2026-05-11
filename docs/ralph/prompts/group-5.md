# Group 5: Dashboard data layer (Eden + Query + Zustand + router-context)

## What You're Doing

Wire the dashboard's data plumbing: an Eden Treaty client, a shared `QueryClient`, the Zustand persist store (minimal scope), and the TanStack Router context that lets loaders call `ensureQueryData`. Establish the query-key factory convention. After this group, a trivial loader → `ensureQueryData` → `useSuspenseQuery` round trip works for at least one existing read endpoint (e.g. `/health` or `/exercises`).

This group is the plumbing only — actual pages are built in Groups 8 + 9.

---

## Required Reading

1. **The PRD section** for this group: `docs/MANTINE-MIGRATION-PRD.md` lines 656-664 (Group 4).
2. The **Data flow** + **Provider tree** subsections in the PRD's Architecture block.
3. `~/SourceRoot/dotfiles/rules/tanstack-router.md` — `load-ensure-query-data`, `ctx-root-context`, `setup-query-client-context`.
4. `~/SourceRoot/dotfiles/rules/tanstack-start.md` — the integration patterns (`setup-`, `flow-`, `cache-`).
5. TanStack Router + TanStack Query integration: https://tanstack.com/router/latest/docs/framework/react/guide/external-data-loading#tanstack-query-integration
6. Eden Treaty docs: https://elysiajs.com/eden/treaty/overview.html
7. Zustand `persist` middleware: https://github.com/pmndrs/zustand/blob/main/docs/integrations/persisting-store-data.md
8. Existing `apps/api/src/index.ts` to learn the `App` export pattern Eden Treaty consumes — if it does not export `app`, leave a note (the API type export is required by Eden).

---

## What to Implement

### 1. `apps/dashboard/src/lib/eden.ts`

```ts
import { treaty } from '@elysiajs/eden';
import type { App } from '@argo/api';

const baseUrl = import.meta.env.VITE_API_URL ?? '/api';
export const api = treaty<App>(baseUrl);
```

The Eden client should not parse dates (`parseDate: false` if the version exposes it, otherwise treat responses as ISO strings consumed by `date-fns`).

Make sure `apps/api/src/index.ts` exports `export type App = typeof app;` — if not, add it as part of this group.

### 2. `apps/dashboard/src/lib/query-client.ts`

```ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
```

### 3. `apps/dashboard/src/lib/store.ts`

A minimal Zustand store with `persist` middleware. Scope is enforced by convention — keep it tiny.

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type UiState = {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
    }),
    { name: 'argo-ui' },
  ),
);
```

Theme is owned by Mantine's `useMantineColorScheme` — do **not** duplicate it in Zustand. Per-page filters that need to survive reloads can be added here later (one slice per page if needed) but the current pass adds only the sidebar slot.

### 4. Router context

Update `apps/dashboard/src/routes/__root.tsx` to use `createRootRouteWithContext<{ queryClient: QueryClient }>()` (see `ctx-root-context` rule). Pass the `queryClient` into the router on construction in `main.tsx`:

```ts
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
});
```

Wrap with the matching declare module block for type registration (see `ts-register-router` rule).

### 5. Query key factory pattern

Create `apps/dashboard/src/lib/queries/` and seed at least one factory to demonstrate the pattern:

```ts
// apps/dashboard/src/lib/queries/health.ts
import { queryOptions } from '@tanstack/react-query';
import { api } from '../eden';

export const healthQueries = {
  all:    () => ['health'] as const,
  status: () => queryOptions({
    queryKey: [...healthQueries.all(), 'status'] as const,
    queryFn: async () => {
      const { data, error } = await api.health.get();
      if (error) throw error;
      return data;
    },
  }),
};
```

Apply the same pattern to one more resource as a teaching example — e.g. `exercises.ts` (whatever the API already exposes).

### 6. Verify the round trip

Pick one route stub (e.g. `garmin-health.tsx`) and wire a trivial proof:

```ts
export const Route = createFileRoute('/garmin-health')({
  loader: ({ context }) => context.queryClient.ensureQueryData(healthQueries.status()),
  component: GarminHealth,
});

function GarminHealth() {
  const { data } = useSuspenseQuery(healthQueries.status());
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
```

This is throwaway — Group 8 rebuilds the page. The point is to prove the data path works end-to-end.

### 7. Devtools

Mount `<ReactQueryDevtools />` and `<TanStackRouterDevtools />` only in dev (gated by `import.meta.env.DEV`).

### 8. Env vars

`apps/dashboard/.env.local.tpl` gets `VITE_API_URL=http://localhost:3000` (or however the dev api runs). `vite.config.ts` proxy can also route `/api/*` → `:3000` if you prefer same-origin — pick one approach and document.

---

## Validation

```bash
bun install
bun --cwd apps/dashboard typecheck
bun --cwd apps/dashboard build
bun run lint
bun run format:check

# Manual:
docker compose -f apps/api/docker-compose.dev.yml up -d
bun --cwd apps/api start &
bun --cwd apps/dashboard dev &
# Open http://localhost:5173 — health JSON renders on /garmin-health
```

---

## Commit

```
feat(dashboard): wire eden treaty + query client + zustand + router context
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then output as the literal last line:

```
RALPH_TASK_COMPLETE: Group 5
```
