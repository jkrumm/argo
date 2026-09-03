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
- `astro-window.tsx` — Astro Window page
- `body-composition.tsx` — Body Composition page
- `calendar.tsx` — Calendar page
- `charts-smoke.tsx` — chart smoke-test page
- `garmin-health.tsx` — Garmin Health page
- `hermes-chat.tsx` — Hermes Chat page
- `m365-explorer.tsx` — M365 Explorer page
- `reading.tsx` — Reading page
- `strength-tracker.tsx` — Strength Tracker page
- `usage-tracking.tsx` — Usage Tracking page
- `walking-pad.tsx` — Walking Pad page

## Adding a page

See `.claude/rules/basalt-state.md`.

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

See `.claude/rules/basalt-batteries.md`.

## Path Aliases

- `@argo/api` → `../api/src` (Eden Treaty type source)

## React Compiler

The dashboard uses `babel-plugin-react-compiler` via `vite-plugin-babel`. All components are automatically memoized where safe. Opt out with `'use no memo'` as the first statement in a component.

## Observability (HyperDX)

`import './lib/hyperdx'` is the **first import** in `main.tsx`. HyperDX patches `window.fetch` on import — any module loaded before it misses tracing. The Vite proxy forwards `/v1/traces` and `/v1/logs` to `127.0.0.1:4319` (unauthed receiver, no key needed in dev); in prod, Traefik routes the same paths on `argo.jkrumm.com` to `clickstack-otel@docker` → `clickstack:4318` (authed, key baked into the bundle via GHA build-arg).

`VITE_HYPERDX_API_KEY` is a placeholder string locally (`local-dev-no-auth` in `.env.local.tpl`) — the SDK requires non-empty but `:4319` ignores the value. **Never set `VITE_HYPERDX_ENDPOINT` to a relative path** like `/` — the OTLP exporter requires absolute URLs and silently falls back to HyperDX Cloud.

`__APP_VERSION__` is injected by Vite at build time (sourced from `package.json` `version`, override via `BUILD_VERSION` env). Surfaced as the `app.version` resource attribute in HyperDX for release diffs. Its ambient declaration ships with basalt-ui (≥1.20.0) via the root barrel — there is no local `declare const` to maintain.

See `.claude/rules/observability.md` for the full configuration contract — first-import constraint, `tracePropagationTargets` regex rules, `ignoreUrls`, prod routing, common pitfalls.
