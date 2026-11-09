# apps/dashboard — Vite + React 19 + Mantine v9

## Stack

- **UI:** Mantine v9 (`@mantine/core`, `hooks`, `form`, `notifications`, `modals`, `dates`)
- **Icons:** `@tabler/icons-react`
- **Routing:** TanStack Router — file-based via `@tanstack/router-plugin/vite`
- **Data:** TanStack Query + Eden Treaty (`@elysiajs/eden`) for type-safe API calls — configured with `{ parseDate: false }` so `YYYY-MM-DD` strings stay strings (matches the API's wire format and TS types)
- **URL + persisted UI state:** one `createSearchStore` per page in `src/lib/window-stores.ts`
  (basalt-ui 1.27.0) — typed fields, URL ⊳ localStorage ⊳ fallback. Zustand survives only for the
  two stores with no URL at all: the rest-timer engine (`lib/timer-store.ts`) and auth
  (`lib/auth.ts`)
- **Charts:** `basalt-ui/charts` (TanStack Charts kinds; each feature keeps its charts under `features/<page>/charts/`) + `src/lib/series.ts` (Argo's per-metric series identity)
- **Dates:** `date-fns` (frontend only; backend sends ISO strings)

## Route Structure

Routes live in `src/routes/`. The generated route tree (`src/routeTree.gen.ts`) is gitignored — regenerated automatically in dev and by `tsr generate`.

- `__root.tsx` — AppShell sidebar layout + theme toggle + `<Outlet />`
- `index.tsx` — Today (the home page: day strip, agenda, calendar activity, an external link to the Console for the factory's pages; `features/home/`, `lib/console-url.ts` joins a path onto the configured `VITE_CONSOLE_URL`; null, no link, when it is unset)
- `astro-window.tsx` — Astro Window page
- `body-composition.tsx` — Body Composition page
- `calendar.tsx` — Calendar page
- `garmin-health.tsx` — Garmin Health page
- `m365-explorer.tsx` — M365 Explorer page
- `models.tsx` — Models page (System → which model to use for what: one log-x scatter of AA intelligence against a weighted efficiency index (toggle to cost, ≈time or ≈tokens per task), your agw slots with the leanest alternative on Max and anywhere, a per-variant catalog table; `features/models/`, data from `GET /api/models/efficiency` via the modelpick relay, plain fetch, contract pinned in `api/types.ts`, logic pure in `model.ts`/`labels.ts`/`pointer.ts` (the scatter's own pointer overlay: nearest dot in 2D pixel space from the chart's clip rect and the page's own domains, since `CartesianChart` exposes no scales; hover shows the tooltip and lights the lineage, a click or tap toggles `pick`); filters and the highlighted lineage are `modelsStore`; fixture shots: `bun scripts/design-shot/models-fixture.ts [--live]` after a dashboard build; `--live` reads a gitignored local snapshot). **This repo is public and Artificial Analysis data is internal use only: fixtures stay synthetic (`features/models/__fixtures__/efficiency.ts`), and real numbers only ever come through the relay**
- `reading.tsx` — Reading page
- `strength-tracker.tsx` — Strength Tracker page
- `usage-tracking.tsx` — Usage Tracking page
- `walking-pad.tsx` — Walking Pad page
- `finance.tsx` (layout: the lock gate + status polling, `features/finance/finance-layout.tsx`) with `finance.index.tsx` (This month: budget month via `?month=`, projection, cumulative pace chart, still due, category vs average, latest bookings, 12-month trend), `finance.spending.tsx`, `finance.recurring.tsx` (subscriptions, bills, due in 30 days, stopped and left out; a row opens `recurring-modal.tsx` for the override), `finance.transactions.tsx` (server-paged ledger, inline category and tax-tag selects with optimistic writes, bulk modal, merchant rule), `finance.net-worth.tsx`, `finance.tax.tsx` (sums per tag and the untagged queue with one-tap tags) — the vault frontend (design: `docs/design/finance-v2.md`); pages live in `features/finance/pages/`, writes in `features/finance/api/mutations.ts` (`useCurate`: optimistic patch of every cached transaction list, rollback and rethrow on failure, one debounced refresh of the derived queries), the filters are `finStore` in `lib/window-stores.ts` (URL only, never localStorage), data goes through `features/finance/api/` (plain `fetch` against `/api/finance/*`, not Eden: the relay returns the service's raw responses). The unlock form keeps the key in an uncontrolled input, never in state, a query or a mutation (their variables outlive the call)

## Adding a page

See `.claude/rules/basalt-state.md`.

**Where things live.** A page is a file route in `src/routes/<name>.tsx` (the route tree is
generated) plus a feature directory `src/features/<name>/`. The nav is `NAV` in `src/lib/nav.tsx`
(`defineNav`, groups such as System); a shell page renders `<PageBar />` only to fill a slot (actions, sync, tabs, filters), the breadcrumb comes
from the nav `label`. A new chart metric needs a `defineSeries` row in `src/lib/series.ts` and a
`DESIGN.md` dictionary row only when it is one of several series; a lone single-series chart stays
neutral (`var(--vx-line)`). A fresh git worktree needs `bun install` before `node_modules/basalt-ui`
(`llms.txt`, `MIGRATING.md`, the rules' targets) exists.

**Stores, route tree, gates.** A page's store goes in `src/lib/window-stores.ts`, not the feature
directory: `src/lib/nav.tsx` is a leaf module (imports nothing from the app) and links with
`store.linkSearch`. `src/routeTree.gen.ts` is gitignored and regenerated by dev/build — never commit
it, whatever a basalt skill's "commit the route tree" step says. The gates are `make check` and
`bun run --cwd apps/dashboard typecheck`/`build`, not the skills' `lint:basalt` / bare `tsc`.
`unwrap` comes from `basalt-ui` (the root entry; `../eden` exports only `api`), in one import with
the other root exports (`PageBar`, …). A new GET endpoint's shape: `GET /openapi/json` on the API.
Minimal route (loaders only where the page prefetches; `validateSearch` only with a search store):

```tsx
// src/routes/my-page.tsx
import { createFileRoute } from '@tanstack/react-router'
import { MyPage } from '../features/my-page/my-page'

export const Route = createFileRoute('/my-page')({ component: MyPage })
```

**`toWindow` IS the projection — there is no `resolveWindow`.** `field.range.toWindow(v)` gives
`{ window }` for a preset and `{ from, to }` for a custom range, and the presets argo's API refuses
(`3m`/`6m`/`1y`/`ytd`) declare a `window:` resolver ON THE FIELD in `lib/window-stores.ts`, so they
come back as explicit dates and are dropped from the `{ window }` branch — the result assigns to the
API param type with no cast. The four per-feature `window.ts` helpers were deleted at basalt-ui
1.27.0. One guard survives on a `custom: true` field (a dateless `'custom'`, unreachable at
runtime): `toApiWindow(resolved, fallback)`, also in `lib/window-stores.ts`. See
`.claude/rules/tanstack-router.md` and the root `.claude/rules/basalt-state.md` for the full law.

**A numeric param is `field.number` + `NumberFilter`, never a string enum.** `astroStore.nights`
carries a real number in the URL (`?nights=10`) with `min`/`max`/`int` on the FIELD, so nothing
downstream parses it and the control bounds its own stepper.

### Query factory

`src/lib/queries/<resource>.ts`:

```ts
import { queryOptions } from '@tanstack/react-query'
import { unwrap } from 'basalt-ui'
import { api } from '../eden'

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

**Nav entry:** see `.claude/rules/basalt-state.md`.

## Theme Toggle

`useMantineColorScheme()` from Mantine — reads/writes `mantine-color-scheme-value` in localStorage. The inline script in `index.html` sets `data-mantine-color-scheme` before first paint, which does two things: it prevents the flash of the wrong scheme, and it **disarms** `basaltAppPlugin`'s anti-FOUC `<style>`, scoped `html:not([data-mantine-color-scheme])` since basalt-ui 1.21.0. After that line Mantine's own layered `color-scheme` rule owns the native controls in both schemes. The inline `style.colorScheme` this script used to write is gone — it existed only to beat the unlayered rule 1.20.0 emitted.

## Persisted UI state

See `.claude/rules/basalt-state.md`.

## Head metadata, manifest & service worker

Owned by `basaltAppPlugin` in `vite.config.ts` — the dual `theme-color` metas, the favicon/apple-touch links, the `apple-mobile-web-app-*` set, `darkreader-lock`, the viewport tag, `site.webmanifest` (generated, **not** a file in `public/`) and the `vite-plugin-pwa` service worker. The theme colors are resolved from basalt's `SURFACE.bg` token, so **never hand-write a hex in `index.html` or a manifest** — `basalt-ui check-theme` scans both. `colorScheme: 'dark'` mirrors `BasaltProvider`'s `defaultColorScheme` in `main.tsx` — keep the two in step. `index.html` keeps only `<meta charset>`, `<title>`, the color-scheme script and the module entry (`<meta charset>` is hoisted to the top of `<head>` by the plugin as of 1.21.0, byte 52 of the built document); `public/` keeps only the icon files. See `.claude/rules/basalt-batteries.md`.

## Charts

See `.claude/rules/basalt-charts.md` and `.claude/rules/charts.md`.

## Commands palette & notifications

See `.claude/rules/basalt-batteries.md`. `emit(kind, { message })` needs the kind registered first in
`src/lib/notifications.ts` (the app's single `defineNotifications` registry); `toMessage` is typed
`{ message: ReactNode }`, so `emit` checks the payload.

A scrolling panel uses Mantine `ScrollArea` (`basalt/raw-scroll-container`).

## Forms and dialogs

A table row action is `rowActions` on `BasaltDataTable`, never a menu in a cell. A form dialog is a
Mantine `Modal` in a `*-modal.tsx` file (the `basalt-controls` filename carve-out) holding the row in
`useState`; `overlays.confirmDelete` covers delete confirmation. Boolean fields bind with
`inputProps(form, path, { type: 'checkbox' })`. In a fresh worktree run `bun install` before reading
`node_modules/basalt-ui` (`llms.txt`, `dist/**/*.d.ts`), and `oxfmt <dir>` fixes a `format:check` failure.

## Shot states (`basalt-ui shot`)

`lib/shot-state.ts` reads `?shot-state=empty|loading|error` once at load: `loading` / `error` are forced at the API client
(`lib/eden.ts` `fetcher`, no retry under `error`), `empty` is page-owned (`shotState() === 'empty'` swaps in the query's empty
value at the read). Declare a state only where production renders it: a route whose loader awaits its data shows the route
pending screen / `CrashFallback`, so its anchors declare `empty` only. `shot` reads the declared set from the rest render, so
`data-shot-states` sits on a rest anchor; every rest anchor gone under a state carries `data-shot-absent`.

## Path Aliases

- `@argo/api` → `../api/src` (Eden Treaty type source)

## React Compiler

The dashboard uses `babel-plugin-react-compiler` through `@vitejs/plugin-react`'s `reactCompilerPreset()` run by `@rolldown/plugin-babel`. All components are automatically memoized where safe. Opt out with `'use no memo'` as the first statement in a component. `bun run build` fails (`scripts/check-compiler.ts`) when no built chunk carries compiler output.

Read field handles with `useField(store.field.x)` (`src/lib/use-field.ts`), never `store.field.x.use()`: the compiler caches the bare call and drops the hook (React #311). `src/lib/use-field.test.ts` enforces it.

## Observability (HyperDX)

`import './lib/hyperdx'` is the **first import** in `main.tsx`. HyperDX patches `window.fetch` on import — any module loaded before it misses tracing. The Vite proxy forwards `/v1/traces` and `/v1/logs` to `127.0.0.1:4319` (unauthed receiver, no key needed in dev); in prod the API process on the mini relays the same paths itself (`POST /v1/traces` and `/v1/logs`, same-origin with `VITE_HYPERDX_ENDPOINT` empty; the upstream credential is the process's own `OTEL_EXPORTER_OTLP_HEADERS`, the public ingestion key baked into the bundle at `make deploy` via `secrets-run`).

`VITE_HYPERDX_API_KEY` is a placeholder string locally (`local-dev-no-auth` in `.env.local.tpl`) — the SDK requires non-empty but `:4319` ignores the value. **Never set `VITE_HYPERDX_ENDPOINT` to a relative path** like `/` — the OTLP exporter requires absolute URLs and silently falls back to HyperDX Cloud.

`__APP_VERSION__` is injected by Vite at build time (sourced from `package.json` `version`, override via `BUILD_VERSION` env). Surfaced as the `app.version` resource attribute in HyperDX for release diffs. Its ambient declaration ships with basalt-ui (≥1.20.0) via the root barrel — there is no local `declare const` to maintain.

**Finance stays out of HyperDX** (ClickStack is on the VPS, the vault's plaintext stays on the mini): `lib/hyperdx-options.ts` sets `blockClass: 'hdx-block'` and ignores `/api/finance/` URLs (no span, no `traceparent`); the finance layout root carries the class and calls `stopSessionRecorder()` on mount / `resumeSessionRecorder()` on unmount (`features/finance/lib/recorder.ts`); no `console.*` in `features/finance` (`consoleCapture` is on; `features/finance/hyperdx-isolation.test.ts` pins all of it). The SDK also stamps `location.href` on every span, so **finance filter values never appear in `window.location`**: `lib/router.ts` builds the router with `createPrivateFinanceHistory()` (`features/finance/lib/private-history.ts`), a browser history whose address bar shows a `/finance/…` href with only `month`, `from`, `to` and `year` kept; the real href (merchant, category, search, account, tag, amount, queue toggles, sort, page, focus) rides in `history.state` (`__finHref`), so the router, the search stores, Links and setters work on the real location, back/forward and a reload on the same entry restore the filters, and a URL opened fresh starts without them. Route masks were tried and do not fit (a mask's `search` function sees the current location, not the destination). A new finance filter is hidden by default (allowlist), and `private-history.test.ts` pins it.

See `.claude/rules/observability.md` for the full configuration contract — first-import constraint, `tracePropagationTargets` regex rules, `ignoreUrls`, prod routing, common pitfalls.
