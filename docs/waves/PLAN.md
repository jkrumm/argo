# argo on basalt-ui 2.0

**Goal:** argo's dashboard runs on `basalt-ui@2.x` in production: every chart on the 2.x kinds, the
shell, routing, tables and AI chat on the 2.0 contracts, SSR-first with streamed sections, and no
workaround for basalt anywhere in argo. Proven against argo's recorded baseline with screenshots,
render and bundle numbers, and OTel traces.

**Gate (every wave):** `make check` green (`AGENTS.md` § Validate: `basalt-ui sync --check`, lint,
format, both typechecks, unit tests) plus `bun run --cwd apps/dashboard build`; `/review` clean on
every merged diff; zero new `basalt/*` suppressions (`theme-allow`, `oxlint-disable … basalt/`); the
wave's evidence in `docs/waves/evidence/w<n>.md`, compared against `docs/waves/evidence/baseline-1.41.md`
from Wave 2 on.

**Mode:** fleet, orchestrated. The orchestrator tab lives in basalt-ui (herdr tab "T3 stack chart
migration") and runs this plan as a second fleet next to basalt-ui's own plan
(`~/SourceRoot/basalt-ui/docs/waves/PLAN.md`, W12–W15). Each lead follows `/wave` `roles/lead.md`,
fans out with `rd fan`, lands with `rd merge`, and does NOT spawn the next wave.

**Deploys during the migration:** argo deploys every push to master (`deploy.yml`, no path filter),
and 1.x and 2.x cannot coexist in one app. Instead of a long-lived branch (the `rd fan`/`rd merge`
tooling only bases on and lands to master), the migration lands on master with `deploy.yml`
DISABLED (`gh workflow disable deploy.yml`) from the 2.0 bump (Wave 3) until cutover (Wave 11);
production keeps serving the last 1.x build, so Warden sees no migration noise. `check.yml` stays on.

**Friction rule:** argo never works around basalt-ui. Every basalt friction goes into
`~/SourceRoot/basalt-ui/docs/waves/argo-friction.md` (what you hit, the workaround you did NOT take,
severity, the argo step it blocks) and that step waits for the basalt-ui 2.x minor that fixes it.
basalt-ui is PR-required: a lead that cannot land the ledger row itself writes it into its wave's
**Left behind** and the orchestrator files it.

## Ground truth and decisions

Inventory: `docs/waves/evidence/w1.md` (every argo import checked against the published 2.0.0
tarball, the measured tsc and lint fallout, the silent semantics). Contract: basalt-ui's
`docs/V2-SPEC.md`; the per-symbol rows: the installed package's `MIGRATING.md` § 2.0; chart mapping:
basalt-ui's `docs/waves/v2-chart-inventory.md` rows a1–a43 (40 production charts + 3 dev).

- **D1 — The bump is atomic and stubs the charts.** Master must be green at every `rd merge`, 1.x and
  2.x cannot share the app, and the tooling bases every worker on master. So Wave 3 lands basalt-ui
  2.0 in one change: wiring, the import moves, the measured non-chart fixes, and every chart file
  that does not compile on 2.0 replaced by a stub. A stub keeps the file's exported signature, renders
  `ChartCard` with `state={{ empty: 'Migrating to basalt-ui 2.0' }}` and carries the marker comment
  `MIGRATION-STUB(w<n>)` naming the chart wave that owns it. The stubs are migration scaffolding on
  2.0's public API, not a workaround; production never sees them (deploys are off), and Wave 11 gates
  on `grep -r MIGRATION-STUB` returning nothing.
- **D2 — Silent semantics land with the bump.** What compiles but behaves differently on 2.0 (chat
  liveness, table sort registry; `w1.md` § 4) is fixed in Wave 3, not later: only the stubs are
  allowed to be visibly unfinished on master.
- **D3 — argo owns a real-data evidence command.** The 1.36 baseline shows empty states (no API), and
  basalt-ui's harness writes into basalt-ui's own tree, which the basalt fleet's `rd close` needs clean.
  Wave 2 adds `make evidence LABEL=<l>` to argo: a production build served on an ephemeral port with
  `/api` proxied to production (bearer from `secrets-run read op://common/api/SECRET` injected into
  `localStorage`), killed on exit, writing `docs/waves/evidence/<label>.md` plus gitignored raw
  output. Lanes: bundle (gzip JS/CSS total and per route chunk from the vite manifest), screens
  (every non-dev route × light/dark × 1280×800/390×844, the 1.36 baseline's matrix), Lighthouse
  (`/`, `/garmin-health`, `/strength-tracker`; mobile + desktop; median of 3). GETs only — no lane
  posts to production.
- **D4 — Owner call before Wave 10.** SSR with argo's bearer-in-`localStorage` auth can render only
  the shell: the server cannot fetch data on the user's behalf. Option A: an HttpOnly, Secure,
  SameSite=Strict session cookie minted from the bearer, accepted by the API next to the bearer, so
  loaders run on the server and sections stream with data (security-adjacent API change). Option B:
  SSR the shell plus sized pending boxes, data stays client-side (no auth change, a much smaller win
  over today's SPA). Tendency: A — B is not "SSR-first with streamed sections" for an authenticated
  dashboard. Wave 10 does not start until the owner picks.
- **D5 — Group-per-worker charts.** Chart waves fan out one worker per feature directory (disjoint
  files); a kind that cannot express an inventory row's "must support" column is a friction row and
  that chart stays a stub until the fixing minor.

## Wave 1 — The migration plan <!-- status: done -->

- [x] Read basalt-ui's 2.0 ground truth: `~/SourceRoot/basalt-ui/docs/V2-SPEC.md`,
      `packages/basalt-ui/MIGRATING.md` § 2.0 (start at "Upgrading from 1.x"),
      `docs/waves/v2-chart-inventory.md` (argo's 48 chart files mapped to 2.0 kinds),
      `docs/waves/evidence/w2/argo-baseline-1.36.md` (argo's baseline), and the shipped `basalt-app`,
      `basalt-charts`, `basalt-design` skills in the published `basalt-ui@2.0.0` tarball.
- [x] Inventory argo against it: every 1.x import that moved or died, `useNav`, `runs.has(id)` as
      "live" (`hermes-row.tsx`, `use-hermes-thread-voice.ts`), the telemetry seam vs HyperDX, the
      two diverging pins (root `package.json` 1.41.0 vs `apps/dashboard` 1.36.0), the Table v9 move.
- [x] Rewrite this file: waves 2..N, three to six steps each, sized for one lead context.
- [x] Commit the plan to argo master; flip Wave 1 to done and Wave 2 to active. Do not start Wave 2.

**Left behind:**

- **Inventory:** `docs/waves/evidence/w1.md`. Headline: 158 import pairs, all valid on 1.41; the bump
  measured at 498 tsc errors → 402 after three specifier moves, of which 305 sit in 38 chart files
  and 97 are wiring. Tables and chat compile after the moves; lint adds ~17 findings (oxlint ≥ 1.87).
- **Shape change vs the brief's expected shape:** setup splits into Wave 2 (1.41, ships live, baseline)
  and Wave 3 (the atomic 2.0 bump, D1), because the green-master gate rules out landing shell, tables
  and chat as separate 2.0 waves before the charts compile. Shell/routing, data/tables and chat
  become depth-and-verification waves on an already-compiling base.
- **For the orchestrator to file in `argo-friction.md`** (papercuts, verified in the tarball, see
  `w1.md` § 7): (1) `MIGRATING.md` "Upgrading from 1.x" step 2 vs `styles.css`/`basalt-app` on
  `@mantine/dates` layer CSS, and `@mantine/schedule` unmentioned; (2) exact `5.2.x` font peers lag
  the published `5.3.0` and `bun` accepts the mismatch silently. Blocks nothing yet; Wave 3 complies
  (exact peers, dates/schedule layer CSS after `basalt-ui/styles.css`).
- **Owner call pending:** D4 (SSR auth), needed before Wave 10, not before.
- **Plan review: none** — a doc-only wave; the orchestrator reviews this plan before spawning Wave 2.

## Wave 2 — 1.41 live, the evidence command, the real baseline <!-- status: active -->

Ships to production (still 1.x); the last wave that deploys before cutover.

- [ ] Align both pins on `basalt-ui` 1.41.0 exact (`apps/dashboard` from 1.36.0; root already 1.41.0)
      and clear what 1.37–1.41 changed for argo (installed `MIGRATING.md` § 1.37.0–1.41.0: forms
      layout moved to `./controls`, content inset 20 → 16, `maxRows` deprecations). `basalt-ui sync`,
      `doctor` clean.
- [ ] Push; the deploy fires; confirm with `make verify` that `commit` equals `origin/master`, Uptime
      Kuma's three `Argo` monitors are green, and `make logs` shows no new errors.
- [ ] Build `make evidence` per D3 (`scripts/evidence/`, a `routes.txt` with the 13 non-dev routes);
      document it in `AGENTS.md` § Verify & Monitor.
- [ ] Record `docs/waves/evidence/baseline-1.41.md` with real data: all three lanes. It is the
      before-picture for every later wave.
- [ ] Turn deploys off: `gh workflow disable deploy.yml`; note in `AGENTS.md` § Deploy that deploys
      are paused for the 2.0 migration until Wave 11 of `docs/waves/PLAN.md`.

**Evidence:** `w2.md` — the 1.41 deploy verification and the baseline run's own log.

**Left behind:**

## Wave 3 — The 2.0 bump (atomic, D1) <!-- status: pending -->

One worker on one branch (D1 forbids splitting the bump); the lead reviews and merges it. Starting
point: `w1.md` §§ 1–4 are the checklist.

- [ ] Dependencies: `basalt-ui` 2.0.0 exact in both `package.json`s, the peers of `w1.md` § 2 (font
      peers exact as published), oxlint ≥ 1.87 and the oxfmt the preset expects, every `@visx/*`
      removed. `basalt-ui sync`, then `doctor` until clean (tsconfig-base, retired-lint-rules,
      dropped-subpaths, app-wiring); drop `basalt.chartMissingAriaLabel`.
- [ ] Wiring per V2-SPEC § 2: `main.tsx` → `BasaltProvider router telemetry fallback paletteOptions`
      (groups as `SeriesGroup[]` from `groupTokens`); `lib/router.ts` → `createBasaltRouter({ routeTree,
      context, query })` carrying argo's 401 `queryCache`/`mutationCache` and retry rules;
      `routes/__root.tsx` → `createRootRouteWithContext<BasaltRouterContext>()`, `BasaltShell nav={NAV}`
      with the calendar/m365 `badges`; `AuthGate` moves inside the router (it can no longer wrap
      `RouterProvider`); delete `BasaltDevDock`, the three dev menu items, `applyOverrides`,
      `BasaltOverlays`, `BasaltErrorBoundary`, `createBasaltQueryClient`. Telemetry sink is a
      dev-console stub here; Wave 4 makes it real. Keep `@mantine/dates`/`@mantine/schedule` layer CSS
      after `basalt-ui/styles.css`.
- [ ] The import moves of `w1.md` § 1, `PageBar`/`Section` action tuples, the `RangeField` handle in
      `routes/strength-tracker.tsx`, the ~17 lint findings fixed at source.
- [ ] Silent semantics (D2): the three chat liveness sites test `run.status` (`'submitted' |
      'streaming'`), and a failed run stays visibly failed; every table `sortFn` is one of the four
      registered names.
- [ ] Every chart file that does not compile becomes a `MIGRATION-STUB(w7|w8|w9)` stub per D1
      (owner wave from the inventory group: usage/walking-pad/agents/smoke → w7, garmin/body → w8,
      strength/astro → w9). Charts that compile as-is stay.

**Evidence:** `w3.md` — `doctor` output, tsc 0, the stub list (file → owning wave), bundle and screens
of the non-chart surfaces (shell, tables, chat, forms) against the baseline.

**Left behind:**

## Wave 4 — Shell, routing, transitions, telemetry <!-- status: pending -->

Fan-out on disjoint files.

- [ ] Telemetry: `lib/telemetry.ts` per V2-SPEC § 7. Answer Open #6 first, from the installed
      `@hyperdx/browser`: if it registers the global `@opentelemetry/api` tracer provider, use the
      spec's adapter verbatim; otherwise map `BasaltEvent` to HyperDX. `service.name` stays
      `argo-dashboard`; `lib/hyperdx.ts` still initialises before anything captures `fetch`.
- [ ] Route transitions: confirm nav-order `defaultViewTransition` fires on every route change in
      Chrome (count `startViewTransition` per navigation across the 13 routes, basalt W10's method);
      no `<ViewTransition>` around `<Outlet>`; reduced motion honoured.
- [ ] Shell parity: sidebar blocks, badges on the collapsed rail, the settings menu, `globalActions`
      mobile projection, breadcrumbs from nav labels — against the baseline at 1280 and 390. Delete
      argo code the shell now owns (e.g. `lib/sidebar-collapsed` if `BasaltShell` persists it).
- [ ] Commands: `lib/commands.tsx` on `@tanstack/react-hotkeys` 0.13 types (`CommandDef.shortcut` is
      the peer's `Hotkey`), Spotlight from `flattenNav`, the provider's `dev.*` commands present in dev.
- [ ] Auth in the router context: a login route, 401 → clear token → redirect, no flash of an
      authenticated shell.

**Evidence:** `w4.md` — screens (shell, nav, mobile) vs baseline, transitions count per route,
telemetry events captured (`route.navigate`, `query.error`) with their attributes.

**Left behind:**

## Wave 5 — Data and tables <!-- status: pending -->

- [ ] The 8 `BasaltDataTable` sites on Table v9 behaviour: string columns sort naturally
      (`alphanumeric`), facets/search use `includesString`, `columnMeta` (`align`/`numeral`/`priority`)
      typed per table, the 250 ms search debounce, `PaginationState` from v9 in
      `walking-pad/session-history.tsx`.
- [ ] `./state` stores (`lib/window-stores.ts` and its consumers): URL ⊳ localStorage ⊳ fallback lanes
      unchanged across reloads and back/forward; `./forms` sites (`auth-gate`, `issues-section`).
- [ ] Query: routes load through `context.queryClient` (`ensureQueryData` in loaders where a route
      already prefetches), `query-fn-unwrap` clean, basalt's query defaults merged with argo's
      deliberately — prepares Wave 10's streamed sections.

**Evidence:** `w5.md` — per table: sort a string column, search, paginate (screens); `./table` bundle
delta vs baseline (accepted upstream at +3.4 KB).

**Left behind:**

## Wave 6 — AI chat and the OTel join <!-- status: pending -->

- [ ] `hermes-transport.ts`: response-body parsing becomes a switch on `AgentError['kind']`
      (`http`/`server`/`stream`/`aborted`, exhaustive with `satisfies never`); failures now reject the
      stream — re-check the F5-mid-turn resume path and stop/supersede in `chat-page.tsx`.
- [ ] `useAgentThreadRuns({ throttle, telemetry })`: keep the 100 ms default unless a profile says
      otherwise; `chat.turn` reaches the Wave 4 sink.
- [ ] Content: every model output through `<Markdown streaming contentTrust="untrusted">`; argo's own
      mermaid/vega fences still render (2.0 made `CodeBlock`/`MermaidDiagram` private); blocked images
      render their alt text.
- [ ] The join: `apps/api` `hermes.stream-lifecycle` (`routes/hermes.ts:968`) also carries
      `basalt.chat.thread_id` with the same thread id `chat.turn` reports; a test asserts both sides
      use one value. The live ClickStack join is a Wave 11 check.

**Evidence:** `w6.md` — chat screens (idle, streaming, failed turn, resumed turn) vs baseline; the
join test; commit counts per reply if the throttle moved.

**Left behind:**

## Wave 7 — Charts A: usage, walking pad, agents, smoke <!-- status: pending -->

Inventory rows a1–a12, a40–a43; one worker per directory.

- [ ] `usage-tracking/charts/*` (a1–a6): `Donut`, `Lines` ×2, `StackedArea` ×3.
- [ ] `walking-pad/charts/*` (a7–a12): `Bars` ×3, `Lines`, `Sparkline` in `StatCard`, `Heatmap` for
      the bespoke time-of-day grid (a11).
- [ ] `agents/hero-stats.tsx` (a40) and the dev `routes/charts-smoke.tsx` (a41–a43) on `Sparkline`/`Lines`.
- [ ] Every ported chart: `ariaLabel`, `state` from its query (never `data ?? []`), Date x where the
      data is temporal, `cursorResolution="leading"` where the inventory says leading; its
      `MIGRATION-STUB(w7)` gone.

**Evidence:** `w7.md` — each chart light/dark × desktop/mobile vs baseline, the group's route
chunks vs baseline, Lighthouse on `/usage-tracking` and `/walking-pad`.

**Left behind:**

## Wave 8 — Charts B: Garmin health, body composition <!-- status: pending -->

Inventory rows a13–a21, a33–a34.

- [ ] `garmin-health/charts/*` (a13–a21): `Bars` ×4, `Lines` ×3 (a15 thresholds above and below, a21
      area gradient + thresholds), `DualPanel` (a17 `differenceY` fill-between), `CartesianChart` (a18).
- [ ] `body-composition/charts/*` (a33–a34): `Lines` with markers, overlay MA, constant reference
      series, per-series area.
- [ ] Same per-chart bar as Wave 7; `MIGRATION-STUB(w8)` gone.

**Evidence:** `w8.md` — as Wave 7, Lighthouse on `/garmin-health` vs baseline.

**Left behind:**

## Wave 9 — Charts C: strength, astro; no stub left <!-- status: pending -->

Inventory rows a22–a32, a35–a39. Strength splits across two workers by file.

- [ ] `strength-tracker/charts/*` (a22–a32): `CartesianChart` (a22 per-point marker colour),
      `DualPanel` (a23), `Lines` ×6 (a24 child MA series, PR markers), `Sparkline` ×3 at 80×28 in a
      table row, `Bars` (a32 `barOpacity`).
- [ ] `astro-window` (a35–a39): `Lines` with `tooltip.onFollow` (a35), `Bars` (a36), `CartesianChart`
      with x-zones and `rect`/`ruleX` annotations (a37), the sky panorama on numeric x — azimuth,
      `areaY`, glow `rect`s, `tooltip={false}` — with its waiver gone (a38), the scout sparkline (a39).
- [ ] `grep -r MIGRATION-STUB apps` is empty; no `@visx` in `bun.lock`.

**Evidence:** `w9.md` — as Wave 7, Lighthouse on `/strength-tracker` vs baseline; a full screens run
of every route.

**Left behind:**

## Wave 10 — Rendering: SSR-first, streamed sections <!-- status: pending -->

Blocked on D4. Pattern: basalt-ui `docs/waves/evidence/w10/ssr.md` and the `basalt-app` skill's
"Stream a slow section".

- [ ] (Option A only) the session cookie in `apps/api` next to the bearer, CSRF covered by
      SameSite=Strict, tests; the login route sets it.
- [ ] A Bun server entry for the dashboard: `createRequestHandler` + `renderRouterToStream`
      (`@tanstack/react-router/ssr/server`), the document rendered by React
      (`<Document><BasaltProvider router/></Document>`), `await hydrate(router)` then `hydrateRoot(document)`.
      Verify `createBasaltRouter` (no `history` option) works per request; if it does not, that is a
      friction row, not a local router.
- [ ] Routes: the shell holds no promise; each slow section is an unawaited loader promise in
      `<Suspense>` + `<Await>` with the chart/table pending state as fallback; browser-only widgets
      (MapLibre map, voice, vega) client-only.
- [ ] Packaging: the dashboard image runs the Bun server instead of nginx (`apps/dashboard/Dockerfile`,
      static assets still immutable-cached, `/v1/*` OTLP proxy kept). Prepare the matching
      `~/SourceRoot/vps/apps/argo/compose.yml` change as a ready diff; it lands in Wave 11, in step
      with the first 2.x image.

**Evidence:** `w10.md` — TTFB, shell flush, per-section reveal, FCP/LCP, CLS 0, hydration time, at 1x
and 4x CPU, against the baseline Lighthouse; a Chrome UA (bots get a buffered document).

**Left behind:**

## Wave 11 — Cutover <!-- status: pending -->

Outward-facing: the orchestrator decides when it runs. Functional parity is the bar; polish happens
live afterwards (basalt-ui W14). Warden watches argo in production and will react to cutover errors.

- [ ] Pre-flight: Gate green, no `MIGRATION-STUB`, zero `basalt/*` suppressions, every argo row in
      `argo-friction.md` closed or explicitly accepted, `basalt-ui sync --check` clean.
- [ ] Land the vps compose change (if Wave 10 changed the serving model), `gh workflow enable
      deploy.yml`, restore `AGENTS.md` § Deploy, push; the deploy fires.
- [ ] Verify live: `make verify` commit = `origin/master`; Uptime Kuma `Argo / API`, `Argo / Dashboard`,
      `Argo / Hermes` green; `make logs` clean; ClickStack shows `route.navigate` from
      `argo-dashboard` and one chat turn whose `chat.turn` joins `hermes.stream-lifecycle` on
      `basalt.chat.thread_id`; screens of every route against `baseline-1.41.md`.
- [ ] Rollback written before the push: re-pin the last 1.x images (`make argo-up` with the previous
      SHAs in `vps`) and re-disable deploys.

**Evidence:** `w11.md` — the live checks above, the final numbers table (bundle, Lighthouse, SSR)
against the 1.41 baseline with every regression accepted or filed.

**Left behind:**
