# apps/dashboard — Vite + React 19 + Mantine v9

## Stack

- **UI:** Mantine v9 (`@mantine/core`, `hooks`, `form`, `notifications`, `modals`, `dates`)
- **Icons:** `@tabler/icons-react`
- **Routing:** TanStack Router — file-based via `@tanstack/router-plugin/vite`
- **Data:** TanStack Query + Eden Treaty (`@elysiajs/eden`) for type-safe API calls — configured with `{ parseDate: false }` so `YYYY-MM-DD` strings stay strings (matches the API's wire format and TS types)
- **Client state:** Zustand (`persist` middleware) — sidebar collapse state only
- **Charts:** `basalt-ui/charts` (visx primitives) + `src/lib/series.ts` (Argo's per-metric series identity)
- **Dates:** `date-fns` (frontend only; backend sends ISO strings)

## Route Structure

Routes live in `src/routes/`. The generated route tree (`src/routeTree.gen.ts`) is gitignored — regenerated automatically in dev and by `tsr generate`.

- `__root.tsx` — AppShell sidebar layout + theme toggle + `<Outlet />`
- `index.tsx` — redirects to `/garmin-health`
- `garmin-health.tsx` — Garmin Health page
- `strength-tracker.tsx` — Strength Tracker page

## Adding a Page

### 1. Create the route file

`src/routes/<page-name>.tsx`:

```ts
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { myQueries } from '../lib/queries/my-resource'

const SearchSchema = z.object({
  window: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
})
type SearchParams = z.infer<typeof SearchSchema>

export const Route = createFileRoute('/my-page')({
  validateSearch: (raw: Record<string, unknown>) => SearchSchema.parse(raw),
  loaderDeps: ({ search }: { search: SearchParams }) => ({
    window: search.window,
  }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(myQueries.summary(deps)),
  component: MyPage,
})

function MyPage() {
  const search = Route.useSearch()
  const { data } = useSuspenseQuery(myQueries.summary({ window: search.window }))
  return <div>{/* render data */}</div>
}
```

Use `loaderDeps` to forward search params to the loader — without it, changes to search params do not re-trigger the loader. See `.claude/rules/tanstack-router.md` for the full template.

### 2. Create the query factory

`src/lib/queries/<resource>.ts`:

```ts
import { queryOptions } from '@tanstack/react-query'
import { api, unwrap } from '../eden'

export const myQueries = {
  all: () => ['my-resource'] as const,
  summary: (params: { window?: string }) =>
    queryOptions({
      queryKey: [...myQueries.all(), 'summary', params] as const,
      queryFn: async () => unwrap(await api['my-resource'].summary.get({ query: params })),
    }),
}
```

Eden Treaty maps hyphenated path segments with bracket notation (`api['my-resource']`). Nested paths use chaining: `api.docker.homelab.containers.get()`.

### 3. Add the sidebar entry

In `src/routes/__root.tsx`, add a `NavLink` alongside the existing entries. Use `useMatchRoute` for active state detection.

### 4. Add the nav link default search

When the route has `validateSearch`, a `redirect` from `index.tsx` or a `NavLink` that pushes to the route must include `search` — otherwise TypeScript raises a `MakeRequiredSearchParams` error.

See `.claude/rules/tanstack-query.md` for the mutation + invalidation pattern.

## Theme Toggle

`useMantineColorScheme()` from Mantine — reads/writes `mantine-color-scheme-value` in localStorage. The inline script in `index.html` prevents flash of wrong scheme on load.

## Charts

`basalt-ui/charts` ships the visx primitives and is theme-agnostic; `BasaltProvider` (mounted in
`main.tsx`) bridges Mantine's color scheme to the charts internally — there is no local bridge file
to maintain.

All chart imports in route components go directly to `basalt-ui/charts`; per-metric series colors
come from `src/lib/series.ts` (Argo's `defineSeries`-based data dictionary, fed into
`BasaltProvider`'s `paletteOptions`):

```ts
import {
  ChartCard,
  ChartLegend,
  ZonedLine,
  VX,
  useHoverSync,
  ChartHoverSync,
} from 'basalt-ui/charts'
import { SERIES } from '../../../lib/series'
```

See `.claude/rules/basalt-charts.md` for the full primitive and kind contract, and `DESIGN.md` for
Argo's series dictionary.

## Commands palette & notifications

`main.tsx` mounts `BasaltOverlays` (from `basalt-ui/commands`) inside `BasaltProvider`, which bundles
the Spotlight command palette (`Cmd/Ctrl+K`), modals, and the notifications toast/history stack.
The app's command and notification registries are defined once via `defineCommands`/`defineNotifications`
in `src/lib/commands.tsx` / `src/lib/notifications.ts` (side-effect imported at boot in `main.tsx`,
before `BasaltOverlays` mounts) — see `.claude/rules/basalt-commands.md` and
`.claude/rules/basalt-notifications.md` for the registry contract.

## Path Aliases

- `@argo/api` → `../api/src` (Eden Treaty type source)

## React Compiler

The dashboard uses `babel-plugin-react-compiler` via `vite-plugin-babel`. All components are automatically memoized where safe. Opt out with `'use no memo'` as the first statement in a component.

## Observability (HyperDX)

`import './lib/hyperdx'` is the **first import** in `main.tsx`. HyperDX patches `window.fetch` on import — any module loaded before it misses tracing. The Vite proxy forwards `/v1/traces` and `/v1/logs` to `127.0.0.1:4319` (unauthed receiver, no key needed in dev); in prod, Traefik routes the same paths on `argo.jkrumm.com` to `clickstack-otel@docker` → `clickstack:4318` (authed, key baked into the bundle via GHA build-arg).

`VITE_HYPERDX_API_KEY` is a placeholder string locally (`local-dev-no-auth` in `.env.local.tpl`) — the SDK requires non-empty but `:4319` ignores the value. **Never set `VITE_HYPERDX_ENDPOINT` to a relative path** like `/` — the OTLP exporter requires absolute URLs and silently falls back to HyperDX Cloud.

`__APP_VERSION__` is injected by Vite at build time (sourced from `package.json` `version`, override via `BUILD_VERSION` env). Surfaced as the `app.version` resource attribute in HyperDX for release diffs.

See `.claude/rules/observability.md` for the full configuration contract — first-import constraint, `tracePropagationTargets` regex rules, `ignoreUrls`, prod routing, common pitfalls.
