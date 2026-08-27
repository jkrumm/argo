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
- **Charts:** `basalt-ui/charts` (visx primitives) + `src/lib/series.ts` (Argo's per-metric series identity)
- **Dates:** `date-fns` (frontend only; backend sends ISO strings)

## Route Structure

Routes live in `src/routes/`. The generated route tree (`src/routeTree.gen.ts`) is gitignored — regenerated automatically in dev and by `tsr generate`.

- `__root.tsx` — AppShell sidebar layout + theme toggle + `<Outlet />`
- `index.tsx` — redirects to `/garmin-health`
- `garmin-health.tsx` — Garmin Health page
- `strength-tracker.tsx` — Strength Tracker page

## Adding a Page

### 1. Declare the page's store

`src/lib/window-stores.ts` is the ONE place a page's search shape lives — one
`createSearchStore` per page, over `field.*` descriptors. It is a leaf module (`lib/nav.tsx` reads
it too), and the value tuples in it are the single source for the type, the control's options and
the route's validator; a feature's `constants.ts` re-exports them.

```ts
export const myStore = createSearchStore({
  key: 'my-page',
  fields: {
    window: field.range({ presets: ['7d', '30d', '90d', 'all'], fallback: '30d', custom: true }),
    tab: field.enum(['charts', 'history'], 'charts'),
  },
}).labels({ window: { '7d': '7D', '30d': '30D', '90d': '90D', all: 'All' } })
```

### 2. Create the route file

`src/routes/<page-name>.tsx`:

```tsx
export const Route = createFileRoute('/my-page')({
  validateSearch: myStore.validateSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(myQueries.summary(myStore.field.window.toWindow(deps))),
  component: MyPage,
})

function MyPage() {
  const search = myStore.useValues()
  return (
    <>
      <PageBar
        tabs={<ViewTabs field={myStore.field.tab} />}
        filters={
          <FilterSet>
            <RangeFilter field={myStore.field.window} customPicker={DateRangePicker} />
          </FilterSet>
        }
      />
      {/* … */}
    </>
  )
}
```

A route whose search carries keys the field vocabulary cannot express (a free date, a
`.transform()`ed codec) hand-writes Zod for THOSE and composes:
`validateSearch: (raw) => ({ ...myStore.validateSearch(raw), ...MapSchema.parse(raw) })` —
`routes/{calendar,astro-window}.tsx` are the two worked examples.

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

### 3. Create the query factory

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

### 4. Add the nav entry — `src/lib/nav.tsx`, and nowhere else

`src/lib/nav.tsx` is the app's ONE navigation definition. Add an item to the right `navGroup`:

```tsx
{
  id: 'my-page',
  label: 'My Page',
  short: 'Mine',              // bar/menu label; falls back to `label`
  mobile: 'tab',              // 'tab' | 'more' (default) | 'hidden' — max 4 tabs + More
  icon: <IconSparkles size={ICON} />,
  link: linkOptions({ to: '/my-page', search: { window: '30d' } }),
}
```

That single entry drives the sidebar row, its active state, the mobile bar slot, the Spotlight
"Go to My Page" command and the breadcrumb. `routes/__root.tsx` only calls
`useNav(NAV, { badges })` and spreads the result onto `<BasaltShell {...nav} />` — never add a
`NavLink`, a `useMatchRoute` call or a `renderNavLink` there again. To point anything else at a
page (an index redirect, an imperative navigate), use `navTarget(NAV, 'my-page')` rather than
restating `to` + `search`.

A page backed by a store does not state ANY of its defaults here: hand the link the store's own
click-time thunk — `search: myStore.linkSearch`, **by reference, never called**. A link that also
carries a key the store does not model spreads it instead:
`search: () => ({ ...myStore.linkSearch(), date })` (calendar and astro are the only two). The
route hands the SAME store its `validateSearch`, so the nav link and the route cannot disagree, the
fallback literal exists in exactly one place, and the page reopens on whatever it was left on. A
`search:` literal inside `defineNav` is `basalt/search-literal-link`.

`nav.tsx` is a LEAF: it may import `@tanstack/react-router`, `basalt-ui/router-tanstack`, icons
and `date-fns` — never `routeTree.gen`, `__root.tsx`, or a feature module. `lib/commands.tsx`
imports it, and `lib/commands.tsx` → `lib/router.ts` → route tree → `__root.tsx`; an edge back
would close that cycle.

### 5. Add the nav link default search

Put every one of the route's default search params in the `linkOptions({ search })` above —
`linkOptions` checks `to` and the route's required search keys, so a missing one is a compile
error (`MakeRequiredSearchParams`). Keys the schema marks OPTIONAL are NOT checked, so a default
that lives in an optional key can still be dropped silently: diff against the route's own zod
`SearchSchema` by hand. `routes/astro-window.tsx` is the worked example — its `.transform()`ed
params are required, and the nav entry hands them the same empty/absent input the URL used to
carry so the route's own codecs resolve the live defaults.

See `.claude/rules/tanstack-query.md` for the mutation + invalidation pattern.

## Theme Toggle

`useMantineColorScheme()` from Mantine — reads/writes `mantine-color-scheme-value` in localStorage. The inline script in `index.html` sets `data-mantine-color-scheme` before first paint, which does two things: it prevents the flash of the wrong scheme, and it **disarms** `basaltAppPlugin`'s anti-FOUC `<style>`, scoped `html:not([data-mantine-color-scheme])` since basalt-ui 1.21.0. After that line Mantine's own layered `color-scheme` rule owns the native controls in both schemes. The inline `style.colorScheme` this script used to write is gone — it existed only to beat the unlayered rule 1.20.0 emitted.

## Persisted UI state

A value a CONTROL reads or writes — a filter, a tab, a per-chart select — is a store field, never
`createPersistedState` and never `useState` (law C3). Page-level fields live on the page's
`createSearchStore`; a per-card select is a `createLocalStore` declared at module scope in the card's
own file (`strength-tracker/charts/{momentum,inol,weekly-volume,strength-composite}-chart.tsx`,
`components/recent-records.tsx` — five of them, keyed `strength:<card>`), and walking-pad's metric
set is a `{ url: false }` field on `walkingStore` rather than a standalone persisted array.

`createPersistedState` from `basalt-ui/state` remains the house API for everything ELSE that must
survive a reload — versioned `{ v, value }` envelope under `basalt:<key>`, cross-tab, SSR-safe.
Sidebar collapse moved onto it at basalt-ui 1.21.0
(`src/lib/sidebar-collapsed.ts`), which is when `BasaltShell`'s own uncontrolled path did; the
module-scope one-time read that carries the pre-1.21.0 raw `argo-sidebar` value forward is what
keeps an already-collapsed sidebar collapsed, and `sidebar-collapsed.test.ts` pins it. Three raw
`localStorage` reads remain and each has a stated reason: `walking-pad/achievements-toast.tsx`
(module-level watermark, no React subscriber), `hermes-chat/voice/audio-player-card.tsx` (per-id
dynamic keys — `createPersistedState` is one key per module factory) and
`strength-tracker/components/timer-core.ts`.

## Head metadata, manifest & service worker

Owned by `basaltAppPlugin` in `vite.config.ts` — the dual `theme-color` metas, the favicon/apple-touch links, the `apple-mobile-web-app-*` set, `darkreader-lock`, the viewport tag, `site.webmanifest` (generated, **not** a file in `public/`) and the `vite-plugin-pwa` service worker. The theme colors are resolved from basalt's `SURFACE.bg` token, so **never hand-write a hex in `index.html` or a manifest** — `basalt-ui check-theme` scans both. `colorScheme: 'dark'` mirrors `BasaltProvider`'s `defaultColorScheme` in `main.tsx` — keep the two in step. `index.html` keeps only `<meta charset>`, `<title>`, the color-scheme script and the module entry (`<meta charset>` is hoisted to the top of `<head>` by the plugin as of 1.21.0, byte 52 of the built document); `public/` keeps only the icon files. See `.claude/rules/basalt-app.md`.

## Charts

`basalt-ui/charts` ships the visx primitives and is theme-agnostic; `BasaltProvider` (mounted in
`main.tsx`) bridges Mantine's color scheme to the charts internally — there is no local bridge file
to maintain.

All chart imports in route components go directly to `basalt-ui/charts`; per-metric series colors
come from `src/lib/series.ts` (Argo's `defineSeries`-based data dictionary, fed into
`BasaltProvider`'s `paletteOptions`):

```ts
import {
  CartesianChart,
  ChartCard,
  ChartLegend,
  deriveLegend,
  VX,
  ZonedLine,
} from 'basalt-ui/charts'
import { SERIES } from '../../../lib/series'
```

Every single-plot cartesian chart composes `CartesianChart` (directly or through a kind) and draws
only marks off `ctx.visible`; the page-wide cursor is shared by default, so there is no hover-sync
provider or hook to wire.

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

`__APP_VERSION__` is injected by Vite at build time (sourced from `package.json` `version`, override via `BUILD_VERSION` env). Surfaced as the `app.version` resource attribute in HyperDX for release diffs. Its ambient declaration ships with basalt-ui (≥1.20.0) via the root barrel — there is no local `declare const` to maintain.

See `.claude/rules/observability.md` for the full configuration contract — first-import constraint, `tracePropagationTargets` regex rules, `ignoreUrls`, prod routing, common pitfalls.
