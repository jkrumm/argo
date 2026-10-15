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
DISABLED (`gh workflow disable deploy.yml`) from the 2.0 bump (Wave 3) until cutover (Wave 10);
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
- **D4 — DECIDED 2026-10-15: no SSR for argo.** Owner: argo is personal software with no SEO need, so it
  stays a client-rendered SPA; no session cookie, no new auth surface. basalt-ui keeps its opt-in SSR
  patterns at full strength without trading anything for argo; their real-consumer proof is weatherorb
  (TanStack Start). Wave 17 is dropped. Original framing: SSR with argo's bearer-in-`localStorage` auth can render only
  the shell: the server cannot fetch data on the user's behalf. Option A: an HttpOnly, Secure,
  SameSite=Strict session cookie minted from the bearer, accepted by the API next to the bearer, so
  loaders run on the server and sections stream with data (security-adjacent API change). Option B:
  SSR the shell plus sized pending boxes, data stays client-side (no auth change, a much smaller win
  over today's SPA). Tendency: A — B is not "SSR-first with streamed sections" for an authenticated
  dashboard. Wave 17 does not start until the owner picks.
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
- **D4 decided 2026-10-15:** no SSR for argo (Wave 17 dropped).
- **Plan review: none** — a doc-only wave; the orchestrator reviews this plan before spawning Wave 2.

## Wave 2 — 1.41 live, the evidence command, the real baseline <!-- status: done -->

Ships to production (still 1.x); the last wave that deploys before cutover.

- [x] Align both pins on `basalt-ui` 1.41.0 exact (`apps/dashboard` from 1.36.0; root already 1.41.0)
      and clear what 1.37–1.41 changed for argo (installed `MIGRATING.md` § 1.37.0–1.41.0: forms
      layout moved to `./controls`, content inset 20 → 16, `maxRows` deprecations). `basalt-ui sync`,
      `doctor` clean.
- [x] Push; the deploy fires; confirm with `make verify` that `commit` equals `origin/master`, Uptime
      Kuma's three `Argo` monitors are green, and `make logs` shows no new errors.
- [x] Build `make evidence` per D3 (`scripts/evidence/`, a `routes.txt` with the 13 non-dev routes);
      document it in `AGENTS.md` § Verify & Monitor.
- [x] Record `docs/waves/evidence/baseline-1.41.md` with real data: all three lanes. It is the
      before-picture for every later wave.
- [x] Turn deploys off: `gh workflow disable deploy.yml`; note in `AGENTS.md` § Deploy that deploys
      are paused for the 2.0 migration until Wave 11 of `docs/waves/PLAN.md`.

**Evidence:** `w2.md` — the 1.41 deploy verification and the baseline run's own log.

**Left behind:**

- **Live:** production runs 1.41 at `ff81fc1`; `deploy.yml` is disabled (`disabled_manually`) and
  `AGENTS.md` § Deploy says so. Re-enable is Wave 11's step.
- **Evidence:** `w2.md` (deploy verification) and `baseline-1.41.md` (the real-data before-picture).
  `make evidence LABEL=<l>` is the command; it needs `secrets-run` and local Google Chrome and
  takes ~5 min. The app POSTs `/api/daily-metrics/refresh` on load — blocked and listed, by design.
- **Plan wording to know:** `charts-smoke` appears in the baseline's route chunks (a dev route, not
  among the 13 screened routes).
- **Uptime Kuma:** the three `Argo` monitors were not read from Kuma (no headless handle); the same
  three endpoints were probed directly and were green.
- **Review:** PR #21 (`make evidence`) reviewed; 3 blocking + hardening fixed. The pin alignment
  (two lines + lockfile) merged without `/review`: nothing to review beyond the version string.
- **Not done in this wave (plan-external, left for the orchestrator):** typechecking and formatting of
  `scripts/**` is outside every gate (`.oxlintrc.json` ignores it, `tsc` never sees it); a
  `scripts/tsconfig.json` + `make check` entry is a small follow-up if the orchestrator wants it.
- **Friction rows for `argo-friction.md`:** none from this wave.

## Wave 3 — The 2.0 bump (atomic, D1) <!-- status: done -->

One worker on one branch (D1 forbids splitting the bump); the lead reviews and merges it. Starting
point: `w1.md` §§ 1–4 are the checklist.

- [x] Dependencies: `basalt-ui` 2.0.0 exact in both `package.json`s, the peers of `w1.md` § 2 (font
      peers exact as published), oxlint ≥ 1.87 and the oxfmt the preset expects, every `@visx/*`
      removed. `basalt-ui sync`, then `doctor` until clean (tsconfig-base, retired-lint-rules,
      dropped-subpaths, app-wiring); drop `basalt.chartMissingAriaLabel`.
- [x] Wiring per V2-SPEC § 2: `main.tsx` → `BasaltProvider router telemetry fallback paletteOptions`
      (groups as `SeriesGroup[]` from `groupTokens`); `lib/router.ts` → `createBasaltRouter({ routeTree,
      context, query })` carrying argo's 401 `queryCache`/`mutationCache` and retry rules;
      `routes/__root.tsx` → `createRootRouteWithContext<BasaltRouterContext>()`, `BasaltShell nav={NAV}`
      with the calendar/m365 `badges`; `AuthGate` moves inside the router (it can no longer wrap
      `RouterProvider`); delete `BasaltDevDock`, the three dev menu items, `applyOverrides`,
      `BasaltOverlays`, `BasaltErrorBoundary`, `createBasaltQueryClient`. Telemetry sink is a
      dev-console stub here; Wave 4 makes it real. Keep `@mantine/dates`/`@mantine/schedule` layer CSS
      after `basalt-ui/styles.css`.
- [x] The import moves of `w1.md` § 1, `PageBar`/`Section` action tuples, the `RangeField` handle in
      `routes/strength-tracker.tsx`, the ~17 lint findings fixed at source.
- [x] Silent semantics (D2): the three chat liveness sites test `run.status` (`'submitted' |
      'streaming'`), and a failed run stays visibly failed; every table `sortFn` is one of the four
      registered names.
- [x] Every chart file that does not compile becomes a `MIGRATION-STUB(w7|w8|w9)` stub per D1
      (owner wave from the inventory group: usage/walking-pad/agents/smoke → w7, garmin/body → w8,
      strength/astro → w9). Charts that compile as-is stay.

**Evidence:** `w3.md` — `doctor` output, tsc 0, the stub list (file → owning wave), bundle and screens
of the non-chart surfaces (shell, tables, chat, forms) against the baseline.

**Left behind:**

- **Landed:** PR #22 merged to master (`a36f135`); `deploy.yml` still disabled. basalt-ui 2.0.0 exact, peers per `w1.md` §2, visx gone. Gate: `make check` + dashboard build green on the merged head; `sync --check` clean; 0 new `basalt/*` suppressions (theme-allow count 6 → 5).
- **Stubs:** 37 files carry `MIGRATION-STUB(w7|w8|w9)` (34 whole charts, 3 partial: `agents/hero-stats`, `astro-window/scout-panel`, `routes/charts-smoke`), plus parked-unused helpers (`applyVisibilityFilter`, `hourlyTimeLabel`, `acwrZoneColor`, `formatRelativeTime`) tagged for their wave. List in `w3.md`. Wave 7 re-adds the agents history query dropped from `routes/agents.tsx`.
- **Auth (Wave 4 inherits):** review caught that loaders fire before `AuthGate` renders. Interim fix: root `beforeLoad: requireToken` + `errorComponent` showing `TokenPrompt`; `AuthGate` stays for mid-session 401. Wave 4's login route replaces this. `lib/auth.test.ts` is not in `make check` (dashboard tests are not run by the gate).
- **Telemetry:** `lib/telemetry.ts` is a DEV-console stub; the crash fallback no longer claims "Reported". Production errors reach nothing until Wave 4.
- **Series CSS vars:** `SERIES` is now `groupTokens('series')` → `--vx-series-*`. `DESIGN.md` still shows `seriesTokens` and "unprefixed" — stale, update with Wave 4 or 8. `docs/poc/astro-map/verify.html` reads old names (lint-excluded POC, left).
- **Not verified:** chat failed-turn path never exercised live (Wave 6); only 3 of 52 `make evidence LABEL=w3` screenshots checked by eye; chart-page numbers are stub placeholders, not comparable to baseline. Bundle JS gzip 2.33 → 2.13 MB; hermes-chat chunk 297 → 349 KB (check in Wave 6).
- **Not done (review improvements skipped, out of scope):** one shared `MigrationPlaceholder` instead of 36 copies (deleted anyway by w7–w9); fallow dead exports (`ACTIVITY`, `colorFor*`, `OVERLAYS`/`COMMANDS`, `NOTIFICATIONS`, `workoutDraftQueries`, devDeps `@types/unist`, `concurrently`); `use-warden-actions.ts` `Date.now()` default in render.
- **Doctor:** at the repo root `basalt-ui doctor` fails `tsconfig-base` and `app-wiring` (expects root `tsconfig.json` / `src/main.tsx`); in `apps/dashboard` it fails on missing `.basalt/manifest.json`. Not monorepo-aware; no root files added to appease it.
- **For the orchestrator to file in `argo-friction.md`** (not worked around): (1) `doctor` is not monorepo-aware (above); (2) `basalt-ui sync` seeds `src/main.tsx`, `src/lib/nav.tsx`, `src/routes/__root.tsx` at the repo root and recreates them each run (manifest lists them; worker deleted them); (3) `groupTokens` has no unprefixed form, so the former `''` group could not be kept — var names changed; (4) `PageBar.actions` requires a `primary` first, so the calendar date nav moved to `filtersEnd`; (5) `keyof` of a `groupTokens` result includes the brand symbol (needs `Extract<…, string>`); (6) no auth seam in `createBasaltRouter`/`BasaltProvider` — argo used router `beforeLoad` (Wave 10 SSR will need one); (7) rows 1–3 already known (fixed in 2.0.1).
- **Review:** `/review` (agent-gateway) on PR #22: 2 blocking (auth/loaders, vega var rename) both verified and fixed, 7 improvements fixed, rest listed above.

## Wave 4 — Shell, routing, transitions, telemetry <!-- status: done -->

Fan-out on disjoint files.

- [x] Telemetry: `lib/telemetry.ts` per V2-SPEC § 7. Answer Open #6 first, from the installed
      `@hyperdx/browser`: if it registers the global `@opentelemetry/api` tracer provider, use the
      spec's adapter verbatim; otherwise map `BasaltEvent` to HyperDX. `service.name` stays
      `argo-dashboard`; `lib/hyperdx.ts` still initialises before anything captures `fetch`.
- [x] Route transitions: confirm nav-order `defaultViewTransition` fires on every route change in
      Chrome (count `startViewTransition` per navigation across the 13 routes, basalt W10's method);
      no `<ViewTransition>` around `<Outlet>`; reduced motion honoured.
- [x] Shell parity: sidebar blocks, badges on the collapsed rail, the settings menu, `globalActions`
      mobile projection, breadcrumbs from nav labels — against the baseline at 1280 and 390. Delete
      argo code the shell now owns (e.g. `lib/sidebar-collapsed` if `BasaltShell` persists it).
- [x] Commands: `lib/commands.tsx` on `@tanstack/react-hotkeys` 0.13 types (`CommandDef.shortcut` is
      the peer's `Hotkey`), Spotlight from `flattenNav`, the provider's `dev.*` commands present in dev.
- [x] Auth in the router context: a login route, 401 → clear token → redirect, no flash of an
      authenticated shell.

**Evidence:** `w4.md` — screens (shell, nav, mobile) vs baseline, transitions count per route,
telemetry events captured (`route.navigate`, `query.error`) with their attributes.

**Left behind:**

- **Landed on master** (`rd merge` of four branches, then follow-ups; `deploy.yml` still disabled): basalt-ui **2.0.2** exact (doctor now monorepo-aware; passes at root and in `apps/dashboard` except `app-wiring`, below), `make check` now also runs the dashboard unit tests and `tsc -p scripts/tsconfig.json` (root `typescript` + `@types/bun` devDeps), `DESIGN.md` on `groupTokens('series')` / `--vx-series-*`, the `Extract<keyof …, string>` workaround removed. Evidence: `w4.md`.
- **CI gap:** `.github/workflows/check.yml` is a basalt-managed file (edits show as drift), so CI does not run the two new gates; only `make check` does. Fix upstream or accept; not worked around.
- **Telemetry:** `lib/telemetry.ts` is the spec adapter verbatim. **Open #6 answered: yes**, `HyperDX.init` registers the global tracer provider. Live gotcha, found only by the evidence run: `@opentelemetry/api` must be **1.8.0** exact (HyperDX registers under 1.8.0 and the API ignores a global from a lower minor, so 1.9.1 gave a silent no-op tracer). Verified live against a local OTLP capture: `route.navigate` (`basalt.route.id`, `basalt.route.from`, `url.path`), `query.error` (`basalt.query.hash`, `basalt.query.failure_count`, `exception.type`, `basalt.error.kind`), `route.error`; `service.name` `argo-dashboard`; no message/stack in basalt attributes. **Privacy note:** HyperDX itself stamps `location.href` (with search params) on every span and `http.url` on fetch spans; that is HyperDX, not the basalt sink, and was already true on 1.x.
- **Transitions:** 1 `startViewTransition` per route change across 12 destinations (forward, reverse, history back), 0 on first load and on search-only changes; reduced motion yields 0 view-transition animations. `/` redirects to Garmin so was not clicked separately.
- **Auth:** `/login` route outside the shell (`lib/auth-gate.tsx` `ShellGate` + `LoginPage`; the page body lives in `lib/` so `PageTitle` is legal without a suppression), root `beforeLoad` redirects to `/login?redirect=<safe path+search>`, 401 clears the token and navigates there, token entry navigates back without a reload. Live: no shell frame, 0 API calls unauthenticated, 401 round trip OK. `safeRedirect` is unit-tested against open-redirect shapes.
- **Shell:** `BasaltShell` now persists collapse (`storageKey="argo-sidebar"`, same `basalt:` envelope, so existing state survives; the pre-1.21 raw `'true'/'false'` migration is gone); `lib/sidebar-collapsed.ts` deleted. Argo's `nav:*` Spotlight commands deleted (the provider lists NAV destinations itself, they showed twice); `dev.router/query/theme` come from the provider, not the registry, so `defineCommands` cannot drop them.
- **Basalt friction to file in `argo-friction.md`:** (A) **collapsed-rail badges never render**: in the collapsed rail the link's right section holding the Badge is `display: none`, so the Calendar count and the sidebar block's `rail: 'dot'` do not show, and a non-primary group ("Other") has no rail entry so M365's badge is unreachable; severity medium, parity regression vs the expanded shell. (B) `doctor` `app-wiring` fails in the monorepo: it wants `src/main.tsx` to use `createBasaltRouter`, but argo creates the router in `lib/router.ts` (a module singleton the 401 handler also needs); not restructured to appease it. (C) `check.yml` managed → CI cannot gain gates (above). (D) Commands: the provider's Spotlight and `defineCommands` both emit nav entries (`nav.<id>` vs a consumer's own), a consumer has no way to label the provider's ones "Go to …" (low).
- **Not verified:** `Back/Forward` transition behaviour beyond one history-back; no 1.41 collapsed-rail baseline exists; total JS is +188 KB gzip vs `w3` with no route-chunk growth, growth is in non-route chunks and **not attributed** (check in Wave 5/6: telemetry + OTel/hyperdx are the prime suspects); `docs/poc/astro-map/verify.html` still reads old series var names (lint-excluded).

## Wave 5 — Data and tables <!-- status: done -->

- [x] The 8 `BasaltDataTable` sites on Table v9 behaviour: string columns sort naturally
      (`alphanumeric`), facets/search use `includesString`, `columnMeta` (`align`/`numeral`/`priority`)
      typed per table, the 250 ms search debounce, `PaginationState` from v9 in
      `walking-pad/session-history.tsx`.
- [x] `./state` stores (`lib/window-stores.ts` and its consumers): URL ⊳ localStorage ⊳ fallback lanes
      unchanged across reloads and back/forward; `./forms` sites (`auth-gate`, `issues-section`).
- [x] Query: routes load through `context.queryClient` (`ensureQueryData` in loaders where a route
      already prefetches), `query-fn-unwrap` clean, basalt's query defaults merged with argo's
      deliberately — prepares Wave 10's streamed sections.

**Evidence:** `w5.md` — per table: sort a string column, search, paginate (screens); `./table` bundle
delta vs baseline (accepted upstream at +3.4 KB).

**Left behind:**

- **Landed:** PR #27 (`14b2eeb`), tests + a deliberate query-defaults merge; `deploy.yml` still disabled. The tables needed **no source change** (audit + browser run, `w5.md`); `./state` and `./forms` were already on 2.0, 15 store-contract tests added. Review: `/review` skipped on #27 (test file plus one config line, diff read by the lead); the tables worker produced no diff.
- **The +188 KB is attributed:** not telemetry (+4.8 KB, Wave 3 → 4 on clean builds); it is stale `shiki` in this machine's `node_modules` (not in `bun.lock`) bundling ~190 KB of lazy grammars. The 1.41 baseline total is inflated by the same. Compare bundles only across `--frozen-lockfile` trees. Detail and table in `w5.md`.
- **Wave 6 decision (content):** argo's lockfile has no `shiki`/`@shikijs/*`, so in a lockfile-faithful (= production) build every code-highlight chunk is a stub that throws "Could not resolve …". Add the three as deliberate deps, or accept unhighlighted code blocks; check what `Markdown` does when the lazy import rejects.
- **Not verified:** natural number order (no live string column has numeric suffixes); sort on skinfold (no rows) and the 8 warden tables (one row each); table bundle delta (`./table` +3.4 KB upstream) not isolable, the route chunks moved with the stubs; reload/back-forward lane order is covered by unit tests, not driven in a browser.
- **Basalt friction to file in `argo-friction.md` (not worked around):** (E) `stickyHeader` on the agents table lets rows show through a ~12 px strip above the header when the page is scrolled (header ~25 px below the app bar, no `stickyHeaderOffset` set), medium-low; (F) a build against a tree without the optional `@shikijs/*` peers succeeds and emits chunks that throw at load instead of failing or omitting them (`vite build` prints nothing), low-medium; (G) agents State badge truncates `WORKING` to `WOR…` at 1280 px, mobile strength-tracker table has an empty leading header column and walking-pad clips at "Peak" (low, needs a basalt look before filing as a bug vs argo column widths). Rows 10-13 untouched.
- **Cleanup:** worker worktrees removed with `rd fan --clean`; nothing stale left in docs.

## Wave 6 — AI chat and the OTel join <!-- status: done -->

- [x] `hermes-transport.ts`: response-body parsing becomes a switch on `AgentError['kind']`
      (`http`/`server`/`stream`/`aborted`, exhaustive with `satisfies never`); failures now reject the
      stream — re-check the F5-mid-turn resume path and stop/supersede in `chat-page.tsx`.
- [x] `useAgentThreadRuns({ throttle, telemetry })`: keep the 100 ms default unless a profile says
      otherwise; `chat.turn` reaches the Wave 4 sink.
- [x] Content: every model output through `<Markdown streaming contentTrust="untrusted">`; argo's own
      mermaid/vega fences still render (2.0 made `CodeBlock`/`MermaidDiagram` private); blocked images
      render their alt text.
- [x] The join: `apps/api` `hermes.stream-lifecycle` (`routes/hermes.ts:968`) also carries
      `basalt.chat.thread_id` with the same thread id `chat.turn` reports; a test asserts both sides
      use one value. The live ClickStack join is a Wave 11 check.

**Evidence:** `w6.md` — chat screens (idle, streaming, failed turn, resumed turn) vs baseline; the
join test; commit counts per reply if the throttle moved.

**Left behind:**

- **Landed on master (unpushed until the close-out push below), no PR:** `4187770` shiki + `@shikijs/langs|themes` exact `4.5.0` (basalt's peer range is `^4.5.0`); `47c6113` API `basalt.chat.thread_id` via `lib/hermes-trace.ts`; `7112548` + `55f5293` `hermes-transport.ts` switch on `AgentError['kind']` with a local `classifyChatError` (basalt does not export `toAgentError`; a test drives the real 409 through the transport) and the Markdown trust tests; `de51913` basalt-ui 2.0.3 (both pins); `250b2bc` `check.yml` now runs `make check`. `deploy.yml` still disabled. Review: gateway `/review` on the first four commits, 0 blockers, all code findings fixed; the 2.0.3 bump and `check.yml` diff were read by the lead, not reviewed.
- **Wave 5 shiki decision done:** proven in a clean `--frozen-lockfile` clone (`w6.md` § chat). When the highlighter import rejects, `Markdown` degrades silently: `highlightCode` catches to `null`, `CodeBlock` stays plain mono, the build still succeeds. Transport, resume and stop code needed no change beyond the error switch (liveness was already by `status`); throttle stays 100 ms.
- **Content step needed no source change:** the one Markdown site (`markdown-part.tsx`) already used `streaming contentTrust="untrusted"` and keeps argo's `card`/`vega-lite` fences; mermaid stays basalt's built-in. Tests cover blocked images (alt text), raw HTML, accent directives.
- **2.0.3 verified:** doctor `app-wiring` passes; `make check` green. Collapsed rail: Calendar dot and `Calendar, N` name confirmed with mocked counts (prod count was 0). **New friction (H):** M365 Explorer sits in the non-primary "OTHER" group and has no collapsed-rail entry, so its count (10) is invisible when collapsed; medium-low, needs a basalt call (surface non-primary badges, or argo promotes the item).
- **Basalt friction still unfiled in `argo-friction.md`:** rows 14-16 were filed by the orchestrator; (H) above is new. `use-stick-to-bottom` and `@tanstack/react-virtual` are also missing from argo's lockfile, so the production build carries stubs for them (the same silent-optional-peer class as row 15): chat degrades to a plain scroll div without auto-stick. Not added, as no step asked for it; orchestrator decides whether chat wants `use-stick-to-bottom`.
- **Observed, not attributed:** after a failed first turn the list composer and the thread's own composer are both visible; the thread's messages query re-404s (designed 404 → empty, via the invalidate-and-poll after a settled run). Neither looks caused by this wave, neither checked against the 1.41 baseline.
- **Not verified:** streaming and resumed-turn screens (no live Hermes in the harness); `@types/unist` is flagged unused by fallow (untouched). The Calendar dot with real counts.
- **Cleanup:** no worktrees were used; nothing stale left in docs.

## Wave 7 — Charts A: usage, walking pad, agents, smoke <!-- status: done -->

Inventory rows a1–a12, a40–a43; one worker per directory.

- [x] `usage-tracking/charts/*` (a1–a6): `Donut`, `Lines` ×2, `StackedArea` ×3.
- [x] `walking-pad/charts/*` (a7–a12): `Bars` ×3, `Lines`, `Sparkline` in `StatCard`, `Heatmap` for
      the bespoke time-of-day grid (a11).
- [x] `agents/hero-stats.tsx` (a40) and the dev `routes/charts-smoke.tsx` (a41–a43) on `Sparkline`/`Lines`.
- [x] Every ported chart: `ariaLabel`, `state` from its query (never `data ?? []`), Date x where the
      data is temporal, `cursorResolution="leading"` where the inventory says leading; its
      `MIGRATION-STUB(w7)` gone.

**Evidence:** `w7.md` — each chart light/dark × desktop/mobile vs baseline, the group's route
chunks vs baseline, Lighthouse on `/usage-tracking` and `/walking-pad`.

**Left behind:**

- **Landed on master** (`rd merge` of three PRs, 1 worker per directory per D5): #29 usage-tracking (a1–a6), #28 agents hero sparklines + charts-smoke (a40–a43), #30 walking-pad (a7–a12). Every row was expressible; **no chart stayed a stub**, `grep MIGRATION-STUB(w7)` is empty. Review: gateway `/review` on all three; 1 blocking each on #28 (null summary plotted as 0) and #29 (day buckets parsed as UTC) and 3 on #30 (sparkline `?? 0`, unweighted pace average vs "distance-weighted" copy, time-of-day hours), all fixed and re-merged; the follow-up diffs were read by the lead, not re-reviewed. `deploy.yml` still disabled.
- **Also landed:** `use-stick-to-bottom` 1.1.6 and `@tanstack/react-virtual` 3.14.14 exact (basalt's peers are ranges; its own devDep pins the virtual one); a clean `--frozen-lockfile` production build now bundles both in `hermes-chat` and carries no stub chunk (`w7.md`). basalt-ui **2.1.0** exact in both pins (via 2.0.5), `classifyChatError` now wraps `toAgentError` (no `Response` is classified in the transport, so no `statusCode` shim), `check.yml` was red on one env-dependent test (`lpTileUrl`, fixed in `7043271`, green since). Lighthouse lane also covers `/usage-tracking` and `/walking-pad`.
- **Evidence:** `w7.md` — bundle (+77 / +76 KB on the two routes = the charts runtime, re-measure after Wave 9), screens 52/52, Lighthouse for five routes, and the M365 collapsed-rail check: **friction (H) is closed by 2.1.0** (`M365 Explorer, 10` with a dot, real data; the Calendar dot only with a mocked count, production's is 0).
- **Not verified:** walking-pad charts and the Peak column at 390 px with data (the harness's 30-day window is empty, last walk 75 days ago). The worker removed `minWidth={640}` from the session-history table (no column had an explicit size), so Peak's clip is unconfirmed; the Heatmap's 18 hour labels (no tick stride) are unseen with data; the sparkline NaN gaps are unseen. Dark mode and mobile were not looked at for the usage charts beyond the screens run.
- **doctor:** `subpath-peers` (new in 2.0.5, still in 2.1.0) fails at the repo root and in `apps/dashboard`: it reports every peer (`ai`, `shiki`, `@tanstack/charts`, …) as not installed because it reads the root `package.json`, while they are declared in `apps/dashboard`. Everything else passes. Not worked around (no peers copied into the root).
- **Friction rows for `argo-friction.md`** (none worked around): (I) `doctor` `subpath-peers` not monorepo-aware (above), medium-low; (J) `Sparkline` has no `state` (pending/error/empty), `StatCard.query` only wraps `breakdown`, so a loading sparkline tile needs hand-rolled `'—'`, low; (K) `StatCardSparklineSize` is not exported, and `react/no-unstable-nested-components` warns on the documented `StatCard` `sparkline` render prop (preset leaves `allowAsProps` off), one lint warning remains, low; (L) `Heatmap` has no x-tick stride (18 labels where 1.x drew 6), and `matchHeight` still needs a pixel height from a measured parent, low; (M) `ChartState.empty` cannot say "loaded, filtered to zero" apart from "no data" beyond a label, low; (N) 1.x `ZonedLine` per-point zone colouring has no equivalent (dev smoke route only), low.
- **Cleanup:** worker worktrees removed with `rd fan --clean`; no stale docs.

## Wave 8 — Charts B: Garmin health, body composition <!-- status: done -->

Inventory rows a13–a21, a33–a34.

- [x] `garmin-health/charts/*` (a13–a21): `Bars` ×4, `Lines` ×3 (a15 thresholds above and below, a21
      area gradient + thresholds), `DualPanel` (a17 `differenceY` fill-between), `CartesianChart` (a18).
- [x] `body-composition/charts/*` (a33–a34): `Lines` with markers, overlay MA, constant reference
      series, per-series area.
- [x] Same per-chart bar as Wave 7; `MIGRATION-STUB(w8)` gone.

**Evidence:** `w8.md` — as Wave 7, Lighthouse on `/garmin-health` vs baseline.

**Left behind:**

- **Landed on master** (`rd merge`, one worker per directory per D5): #31 body-composition (a33–a34), #32 garmin-health (a13–a21). Every row was expressible; **no chart stayed a stub**, `grep MIGRATION-STUB(w8)` is empty (16 markers remain, all w9: strength-tracker, astro-window). Also landed: **basalt-ui 2.2.0** exact in both pins (`2f7a3a4`): `StatCard` sparkline sites spread `size` into `Sparkline` (`walking-pad/charts/sparkline-grid-chart.tsx`, `agents/hero-stats.tsx`, `StatCardSparklineSize` imported), the `no-unstable-nested-components` warning is gone, `doctor` at the repo root is fully green (`subpath-peers` fixed upstream). Friction rows 20–25 status below.
- **Review:** gateway `/review` on both PRs. #31: one blocker, a false positive (`weight_kg` is `notNull`, nothing can be null), the rest fixed (shared `compareByDate`/`markerRadiusFor`, `ma: number`, `userProfileQueries` moved to `lib/queries/user-profile.ts`, 30-day boundary documented and tested). #32: 4 blockers — `cursorResolution="leading"` on all nine (fixed), VO2-only rows dropped by `buildFitnessData` (fixed, tested), plus two NOT fixed on purpose (stress gradient = basalt gap, activities window = inherited, both below); improvements fixed: strict null checks, one `latest` rule, shared `movingAverage`, dead `formatRelativeTime` deleted. Follow-up diffs read by the lead, not re-reviewed.
- **Evidence:** `w8.md` — screens 52/52, bundle, Lighthouse; Garmin chunk +78 KB beyond initial (charts runtime, paid once), Lighthouse within noise.
- **Wave 7 unverified items:** walking-pad charts/Peak at 390 px with data, the Heatmap hour labels, the sparkline gaps: the harness's 30-day window is still empty for walking-pad, so still **unverified**; the 2.2.0 Heatmap stride and Sparkline `state` are adopted-by-bump only, unseen with data.
- **Not verified:** only the first chart per page was seen rendered (viewport screenshots): seven of nine Garmin charts and skinfold were not looked at; negative-bar stacking in body-battery and sleep-breakdown, DualPanel `differenceY` fill, and acwr/stress thresholds are checked against the 1.x source by the reviewer, not by eye. Dark mode and mobile for the new charts only for the one screenshot above.
- **Basalt friction for `argo-friction.md`** (none worked around): (O) `Lines` `area` cannot express the 1.x stress chart's vertical zone-coloured gradient (rest/low/moderate/high); the port keeps a series area plus the >75 fill, so the chart is plainer than 1.x, low-medium; (P) the monotone curve is not exported to `CartesianChart`, so fitness-trends' RHR/HRV lines use the engine's default curve, low; (Q) `ChartState` rejects `empty: undefined` under `exactOptionalPropertyTypes` (workers pass `false`), so `cond ? msg : false` is the idiom, papercut. Rows 20–25: 20, 21, 22, 23 fixed in 2.2.0 and adopted/verified by `doctor`, lint and the sparkline spread (23 unseen with data); 24 (`empty` cannot tell filtered-to-zero from no data) and 25 (`ZonedLine` per-point zones) not addressed in the 2.2.0 notes the orchestrator gave, so they stay open.
- **Bugs found, not fixed (outside the ask):** Activities chart ignores the preset window (inherited from 1.x, above): fix by deriving `dateFrom` from `window` and paginating on `total`; the garmin and walking-pad `chart-state.ts` are byte-identical (hoist when w9 adds a third); `activity-score-chart.tsx` duplicates the server's MET constants (carried from 1.x).
- **Cleanup:** worker worktrees removed with `rd fan --clean`; no stale docs. The two workers' panes had a stray `merge it` in their input line; nothing sent it, nothing merged from them.

## Wave 9 — Charts C: strength, astro; no stub left <!-- status: done -->

Inventory rows a22–a32, a35–a39. Strength splits across two workers by file.

- [x] `strength-tracker/charts/*` (a22–a32): `CartesianChart` (a22 per-point marker colour),
      `DualPanel` (a23), `Lines` ×6 (a24 child MA series, PR markers), `Sparkline` ×3 at 80×28 in a
      table row, `Bars` (a32 `barOpacity`).
- [x] `astro-window` (a35–a39): `Lines` with `tooltip.onFollow` (a35), `Bars` (a36), `CartesianChart`
      with x-zones and `rect`/`ruleX` annotations (a37), the sky panorama on numeric x — azimuth,
      `areaY`, glow `rect`s, `tooltip={false}` — with its waiver gone (a38), the scout sparkline (a39).
- [x] `grep -r MIGRATION-STUB apps` is empty; no `@visx` in `bun.lock`.

**Evidence:** `w9.md` — as Wave 7, Lighthouse on `/strength-tracker` vs baseline; a full screens run
of every route.

**Left behind:**

- **Landed on master** (`rd merge`, one worker per directory per D5; strength split across two workers): #34 strength (1/2: one-rm-trend, momentum, relative-progression, strength-composite, weekly-volume), #35 strength (2/2: inol, readiness-strain, training-load, sparkline-grid), #36 astro-window (a35–a39, sky panorama on numeric azimuth, waiver gone), #33 the Activities fix (preset window derives `dateFrom`, pages on `total` in batches, dead `activitiesQueries.list` deleted, tested). `grep MIGRATION-STUB apps` is empty, `@visx` is not in `bun.lock`, no new `basalt/*` suppressions (the 5 `theme-allow`s predate this wave). `chart-state.ts` hoisted to `lib/chart-state.ts` before the fan-out (third consumer). **basalt-ui 2.3.0** exact in both pins: stress chart is `area: 'zones'` plus three zones (replaces the >75 threshold fill), fitness-trends RHR/HRV lines take `chartCurve('monotone')`, and `chartStateOf`'s `empty` is `string | undefined` (the `: false` idiom is gone everywhere).
- **Review:** gateway `/review` on all four PRs. Blockers fixed: #35 INOL empty-selection fallback never fired, #33 unbounded page fan-out, #34 momentum colour from a stale selection, composite store rebuilt per leader, first-in-window flagged as PR, client direction thresholds diverged from the server's. #36 had none (perf: skyglow mark dedup, duplicated gate formula, `?? 0` months, slider aria-label, fixed). The #34 first review hung on the frontend angle and was re-run with `typescript` + `qa` only, so #34 had no frontend-angle review. Fix commits and the 2.3.0 commit were read by the lead, not re-reviewed.
- **Gate:** `make check` green, dashboard build green. **Evidence:** `w9.md` (bundle, screens 52/52, Lighthouse incl. `/strength-tracker`), run on the 2.3.0 tree. Compare with `w8.md`/`baseline-1.41.md`.
- **Not verified:** the screens are viewport-only: the sky panorama, night timeline, stress zone fill, fitness-trends curve, and every strength chart below the Strength Scan were not seen rendered. Walking-pad charts, the Peak column at 390 px and the Heatmap ticks are still **unverified with data** (harness window empty, last walk 75 days ago); keep them listed. Dark mode/mobile for the new charts only via the screens run.
- **Friction (none worked around)** for `argo-friction.md`: (R) strength-composite's default exercise follows a prop (the leader) but `createLocalStore` cannot take a prop-derived fallback: it is rebuilt per leader via `useMemo` (same key), cost is a new store instance on leader change; (S) tooltip rows carry only `{label, value, color}`: no dashed swatch (Garmin Recovery), no per-point coloured row; (T) `Bars` has no legend entry for a ref line, so the weekly-volume MEV/MAV/MRV legend is three always-null `reference` series; (U) `DualPanelBar.format` serves both axis and tooltip (momentum keeps `formatValue` for the tooltip); (V) astro: no `cursorValue` (the sun track now has a cursor dot), `marks` has no curve access in 2.2 (fixed for lines by 2.3's `chartCurve`; night-timeline tracks were not re-checked), `rect` takes one fill string (skyglow = one mark per bucket), no top-edge rule for the shooting-window band (two `ruleX` at the sides). Friction rows 24/25 are closed by design, 26–28 are fixed in 2.3.0.
- **Known, not fixed:** the glow field and the Suspense wrappers in `routes/astro-window.tsx` are now inert (the charts use `useQuery` + state); strength charts share `localDay`/`latestWith` from garmin-health (cross-feature import, candidate for `lib/`); `trailing-ma.ts` duplicates garmin-health's `movingAverage`; `activity-score-chart.tsx` still duplicates the server's MET constants.
- **Cleanup:** worker worktrees removed with `rd fan --clean`; no stale docs. A stray `git stash pop` of the old parked wildrift stash was reverted (the stash entry is intact).

## Wave 10 — Cutover (static build) <!-- status: done -->

Outward-facing: the orchestrator decides when it runs. Functional parity is the bar; polish happens
live afterwards (basalt-ui W14). Warden watches argo in production and will react to cutover errors.
Reordered 2026-10-14 by the orchestrator: the cutover ships the static nginx build now (every chart
ported, no stub); SSR (Wave 17) waits on owner call D4 and ships live as its own deploy afterwards.

- [x] Pre-flight: Gate green, no `MIGRATION-STUB`, zero `basalt/*` suppressions, every argo row in
      `argo-friction.md` closed or explicitly accepted as a post-cutover loop item, `basalt-ui sync
      --check` clean.
- [x] Look before shipping: full-page (not viewport) screenshots of every route, light and dark, 1280
      and 390, against production data via `make evidence`, reviewed by eye with `@verifier`; every
      chart Waves 7-9 left "not seen rendered" is seen here. A broken chart blocks the cutover; a
      cosmetic gap becomes a friction row.
- [x] `gh workflow enable deploy.yml`, restore `AGENTS.md` § Deploy, push; the deploy fires (static
      nginx image, no vps change).
- [x] Verify live: `make verify` commit = `origin/master`; Uptime Kuma `Argo / API`, `Argo / Dashboard`,
      `Argo / Hermes` green; `make logs` clean; ClickStack shows `route.navigate` from
      `argo-dashboard` and one chat turn whose `chat.turn` joins `hermes.stream-lifecycle` on
      `basalt.chat.thread_id`; screens of every route against `baseline-1.41.md`.
- [x] Rollback written before the push: re-pin the last 1.x images (`make argo-up` with the previous
      SHAs in `vps`) and re-disable deploys.

**Evidence:** `w10.md` — the live checks above, the final numbers table (bundle, Lighthouse) against
the 1.41 baseline with every regression accepted or filed.

**Left behind:**

- **Shipped 2026-10-14 21:22 UTC**, commit `90e1c96`: the static nginx build on basalt-ui 2.4.0, live and verified. `deploy.yml` is enabled again, `AGENTS.md` § Deploy restored. Rollback to 1.x `ff81fc1` is in `w10.md`.
- **The first visual check held the cutover:** `Lines` broke strength-tracker Relative Progression and Estimated 1RM at null rows (friction row 34). basalt-ui 2.4.0 shipped `gaps: 'connect'`; the re-check was clean. Also adopted from 2.4.0: `RefLine.legend` (weekly-volume landmarks), DualPanel `tooltipFormat` (momentum), `XZoneSpec.edge` (night-timeline shooting window; the chart is now `Lines`). Row 35 (pre-commit on all-ignored files) fixed in 2.4.0 too.
- **Live checks (all green, details in `w10.md`):** `make verify` commit = `origin/master`; Uptime Kuma Argo group, Dashboard, API, Hermes up; `make logs` clean; ClickStack has 16 `route.navigate` from `argo-dashboard` over 11 routes and a `chat.turn` that joins `hermes.stream-lifecycle` on `basalt.chat.thread_id`; a live browser pass of all 13 routes; Warden opened no argo item in 13 minutes.
- **Not verified:** the night-timeline shooting-window band and its edge rules (no night in the data has a window), walking-pad charts and skinfold with data (empty windows), tooltips, and the `SelectFilter`/`cursorValue` items below. The screens are gitignored raw output under `docs/waves/evidence/.raw/w10/`.
- **Friction still open, accepted post-cutover:** row 9 (auth seam, SSR needs it), row 29 (`createLocalStore` `use({ fallback })` exists in 2.4.0, but `SelectFilter` has no call-site fallback, so the dropdown would show another lift than the chart; the per-leader store stays: file as a new row), row 33's sun-track `cursorValue` (the panorama's sun dot is a scrub marker, nothing to replace).
- **Found, not argo-caused (loop items):** `GET /hermes/threads/:id/messages` 404s for a brand-new thread (12 in 24 h, 3 threads, span status Ok): a read-after-create race. No `traceparent` from the dashboard's `chat.turn` to the API's `hermes.stream-lifecycle`: they join on the business attribute only. MapLibre `circle-11` image warning on the Map tab. Cosmetic: garmin-health y-ticks inside the plot, weekly-volume landmark swatches low contrast on dark, walking-pad "No walks yet" ignores sessions older than the window, 390 px clipping (body-composition input, strength scan table), Heatmap and `Needs you` hero vs section counts differ by design.
- **Process:** `rd close` is for the orchestrator; Wave 11 stays `pending` on owner call D4 (session cookie vs shell-only SSR). Not spawned.

## Wave 11 — Loop round 1: suppressions, DX trial, live fixes <!-- status: done -->

The first round of the basalt-ui ⇄ argo loop (basalt-ui `docs/waves/PLAN.md` W14), on live master. Its
exit criterion is basalt-ui's, recorded per round in `docs/waves/evidence/w<n>.md`: a full argo wave
with zero new friction that needed a workaround or a basalt change; zero `basalt/*` suppressions in
argo; a clean fresh-agent DX trial; no unaccepted regression against the baseline.

- [x] Zero basalt suppressions: remove the 5 `theme-allow` waivers that predate the migration by fixing
      each at the source (or, if one is a basalt gap, a friction row and the waiver stays until the
      fixing minor). `basalt-ui check-theme --audit-allows` clean.
- [x] argo-side live bugs: the `GET /hermes/threads/:id/messages` 404 on a brand-new thread (read
      after create), the MapLibre `circle-11` image warning, walking-pad "No walks yet" ignoring
      sessions older than the window, 390 px clipping on the body-composition input and the strength
      scan table. Each fixed with a test or a screenshot.
- [x] DX trial: a fresh agent with only argo's shipped basalt layer (AGENTS.md block, `.claude/rules`,
      `.claude/skills`) adds a new dashboard route with a chart, a table and a chat-adjacent card to
      argo on a throwaway branch (never merged). Record every wrong turn; a basalt-rooted one is a
      friction row, an argo-rooted one is fixed here.
- [x] (carried into Wave 12, the release shipped after this round closed) Adopt the basalt-ui release the orchestrator announces for rows 36-38 (select-filter call-site
      fallback, chat traceparent, chart axis/legend cosmetics) and drop the per-leader store rebuild.

**Evidence:** `w11.md` — the audit-allows output, the DX trial transcript summary with every wrong
turn classified, before/after screens for the fixes, and the exit-criterion table for this round.

**Left behind:**

- **Landed on master** (`rd merge`, `make check` green, `make verify` + `make logs` after each; `deploy.yml` live): #38 waivers, #40 weight row at 390 px, #39 new-thread 404, #37 `circle-11` + walking-pad empty state, #41 Strength Scan table; plus a docs commit closing the argo-rooted DX gaps (`apps/dashboard/AGENTS.md` "Adding a page"). Master `204b625` is live. Evidence: `w11.md` (audit output, fixes, DX log, exit table). Gateway `/review` on all five; blockers on #39 and #37 fixed and re-merged; fix diffs read by the lead, not re-reviewed.
- **Step 1 done with one waiver kept:** `timer-card.tsx:563` (`control-outside-home` + `raw-selection-control`) is a basalt gap, not worked around.
- **Step 4 NOT done (left unticked):** the basalt release for rows 36-38 is not published (npm `latest` is 2.4.0, installed). The per-leader `strength-composite` store rebuild stays. Wave 11's exit criterion is therefore not met; the orchestrator decides whether to open a round 2 after that release.
- **DX trial:** branch `w11/dx-trial` (pushed, never merged, no PR; delete when no longer needed). Green first try in 114 s, zero suppressions. Wrong turns: 3 argo-rooted (fixed), 3 basalt-rooted (below).
- **Basalt friction for `argo-friction.md`** (none worked around): (W) no bound control for a runtime-mode switch backed by an external zustand store inside a card body (`timer-card` rest/interval; `ViewTabs`/`field` need `createSearchStore`/`createLocalStore`), low; (X) the `basalt-app` skill's route example is `<h2>` with no `PageBar`, and no doc says whether a shell page renders `<PageBar />` or which of `ChartCard`/`Lines` owns `state`, low; (Y) `query-fn-unwrap` reads unconditional but lint fires only on API-client results, so a mock `queryFn` cannot tell if it complies, low.
- **Not verified:** `circle-11` warning gone (no browser look at the Map tab), 404 count in ClickStack after deploy, explorer two-pane layout after `Card.Section`, walking-pad "last walk <date>" copy (no data in window), Scan table below 390 px with real folds opened. No bundle/Lighthouse re-run this wave.
- **Known, not fixed:** `explorer-page.tsx` `M365ExplorerPage`/`DetailPane` are very-high complexity (fallow), nested `badgeColor` ternary; after a failed first turn the list and thread composers both show (not investigated). The gateway review of #41 diffs against a stale worktree base and reports merged work as deleted; read `git diff origin/master...HEAD` after `git fetch` instead.
- **Cleanup:** worktrees for merged branches removed with `rd fan --clean`; `w11/dx-trial` worktree kept deliberately.

## Wave 12 — Loop round 2: adopt 2.6, zero waivers, second DX trial <!-- status: done -->

Round 2 of the loop on live master. The exit criterion is the same four-part one (Wave 11 intro); this
round must record each part as met or name the friction row that keeps it open.

- [x] Bump both pins to basalt-ui 2.6.0 exact; `basalt-ui doctor` and `sync --check` clean. 2.6.0 makes
      `basalt/query-fn-unwrap` live again (dead since 1.29.0): fix every new finding at the source.
- [x] Adopt the fixes for rows 36-41: strength-composite binds `store.field.exercise.withFallback(leader)`
      (drop the per-leader store); timer-card binds `externalField({ values, fallback, labels, store })`
      over the zustand store and mounts `ViewTabs` in the card header slot (drop the last `theme-allow`);
      the telemetry sink gets `startChatTurn` so the chat request carries `traceparent` (CORS on the API
      allows it); check garmin-health y labels and the weekly-volume landmark swatches in dark mode.
- [x] Exit-criterion evidence: `check-theme --audit-allows` shows zero `basalt/*` waivers; a FRESH DX
      trial (new agent, new throwaway branch, never merged, different task from round 1: a page with a
      filtered table and a chart sharing one store field) records every wrong turn; `make evidence` bundle
      and Lighthouse re-run against `baseline-1.41.md`, regressions accepted or filed; ClickStack shows
      one chat turn whose API span is a child of the dashboard's `chat.turn` span.

**Evidence:** `w12.md` — the four-part exit table for round 2, each part met or blocked by a named row.

**Left behind:**

- **Landed on master** (`rd merge`, one worker per change, `make check` green, each deploy verified with `make verify` + `make logs`): #42 basalt-ui **2.6.0** exact in both pins (`doctor` and `sync --check` clean, `query-fn-unwrap` live with 0 findings), #43 strength-composite on `store.field.exercise.withFallback(leader)` (per-leader store gone), #44 timer-card on `externalField` + `ViewTabs` in `WidgetHeader` (`timerMode` in `lib/timer-store.ts`; last waiver gone), #45 `startChatTurn` in `lib/telemetry.ts` (the event decorates the open `chat.turn` span instead of a second span), #46 a docs commit plus the `ignoreUrls` fix below. Master `16f331e` is live. Gateway `/review` on #43-#45: 1 blocking (span registry overwrite on a second turn per thread) and 9 improvements, fixed in `0ba5142` (diff read by the lead, not re-reviewed). #46's one-line fix was read by the lead, not reviewed.
- **Exit criterion, round 2** (`w12.md`): zero waivers **met** (`--audit-allows` 0); DX trial **met** with doc friction; no unaccepted regression **met** (JS +3.0% vs baseline, scores within noise, mobile LCP lower); the full-wave and trace criteria **met**: ClickStack shows a real turn whose `hermes.stream-lifecycle` is a descendant of the dashboard's `chat.turn`.
- **Found only by the live check:** the first `traceparent` never reached the API. HyperDX's fetch instrumentation overwrites the sink's header on same-origin requests (a `HTTP POST` fetch span became the parent, in a separate trace). Fixed in argo by putting the chat POST in HyperDX `ignoreUrls` (`lib/hyperdx.ts`); the chat request now has no fetch span of its own. Filed as a friction row below, since the `startChatTurn` docs say nothing about it.
- **DX trial 2:** branch `w12/dx-trial-2` (pushed, never merged, no PR; delete when no longer needed). 8 wrong turns: argo-rooted ones fixed in `apps/dashboard/AGENTS.md` (page stores live in `lib/window-stores.ts`, `routeTree.gen.ts` is gitignored, the repo's gates, a minimal route to copy). Runtime (reload survival of the shared filter) was not exercised in a browser.
- **Basalt friction for `argo-friction.md`** (none worked around): (Z) `startChatTurn` docs/example do not mention that a fetch instrumentation (OTel web, HyperDX) overwrites the returned `traceparent` on same-origin requests; consumers must ignore the chat URL in the instrumentation or make the turn span the active context, low-medium; (AA) `llms.txt` lists subpaths and exports but gives signatures only for `format`; `state`/`table`/`controls`/`charts` need `dist/**/*.d.ts`, low; (AB) the `basalt-app` skill says to commit `src/routeTree.gen.ts` and the `basalt-charts` skill says `bun run lint:basalt` / bare `tsc`, which are wrong for a monorepo whose route tree is gitignored, low; (AC) `basalt-batteries` names `unwrap` but not its import path, and `EnumFilter` ships a `.d.ts` without being exported from `controls`, papercut.
- **Not verified:** the DX-trial route at runtime; walking-pad charts and skinfold with data (windows still empty); the Heatmap hour labels; the Warm-up/Work/Drop legend swatches compute to one colour while the bars use three shades (seen by the verifier in dark mode, not fixed, outside the ask).
- **Known, not fixed:** the two Hermes threads created by the trace checks (`1fcd4ce3…`, `907d7101…`) remain in production; basalt `chat.turn` emits no span when the turn is `stopped` (the sink span still ends via `settle`).
- **Cleanup:** worker worktrees removed with `rd fan --clean`; `w12/dx-trial-2` kept deliberately. Wave 13 stays `pending` on owner call D4; not spawned.

## Wave 13 — Loop round 3: the convergence check <!-- status: done -->

Round 3 exists to close the loop. If this wave records zero new basalt friction that needed a
workaround or a basalt change, and the other three exit parts hold, the loop is converged
(basalt-ui `docs/waves/PLAN.md` W14).

- [x] Bump both pins to basalt-ui 2.6.1 exact; `doctor`, `sync --check`, `check-theme --audit-allows`
      clean (still zero waivers). Verify rows 42-46 live: the trace docs match argo's setup, the strength
      legend swatches match their bar shades in dark mode.
- [x] DX trial 3: a fresh agent, a new throwaway branch (never merged), a task neither earlier trial
      covered: a settings-style page with a form (`basalt-ui/forms`), a `DataTable` with a row action, and
      a `Sparkline` in a `StatCard`. It may use only argo's shipped basalt layer, `llms.txt` and the
      installed types. Record every wrong turn and classify it (basalt / argo / model).
- [x] Clean up the round 1 and 2 trial branches (`w11/dx-trial`, `w12/dx-trial-2`) and the two Hermes
      threads created by the trace checks.
- [x] Exit table for round 3 in `w13.md`: each of the four parts met, or the friction row that blocks it.

**Left behind:**

- **Landed on master:** #48 basalt-ui **2.6.1** exact in both pins (`rd merge`, `make check` + dashboard build green; deploy `a5dabaf` verified: `make verify` commit = `origin/master`, `deploy.yml` and `check` success). `doctor` all green, `sync --check` clean, `--audit-allows` 0. Review: none on #48, the diff is a version string, the lockfile and `basalt-ui sync` output (read by the lead). Then a docs commit: three argo-rooted DX fixes in `apps/dashboard/AGENTS.md` (`unwrap` from `basalt-ui`, an inline minimal route, the OpenAPI pointer) and the two older trial logs. Evidence: `w13.md`.
- **Exit criterion, round 3: NOT converged.** Zero waivers **met**; no regression **met by inspection** (patch bump, no `make evidence` re-run); full-wave and clean-DX-trial **not met**: the trial hit new basalt-rooted friction, one gap routed around (rows AD-AH).
- **Rows verified live:** Z closed (the `startChatTurn` doc now names `ignoreUrls`, matching `lib/hyperdx.ts`), AB and the `unwrap` half of AC closed by 2.6.1 skill/rule text. Dark-mode strength legends: swatches match the bars on every chart checked; the round 2 "Warm-up/Work/Drop is one colour" does not reproduce (that legend is Weekly Volume). Momentum's legend has one swatch for green and red bars (minor, uninvestigated).
- **Basalt friction for `argo-friction.md`** (none worked around in argo; the trial branch used a plain Mantine `Menu` for AE): (AD) `llms.txt` `controls` description and the `dist/forms/index.d.ts` header name exports that do not exist (`FormSection`, `FormActions`, `OverflowMenu`, `ActionGroup`; `useFormSubmit`, `FormStateProvider`, `useFieldArray`, `useFormDraft`), 3 TS2305 and guesses, medium; (AE) no per-row action seam on `BasaltDataTable` (only `onRowActivate`, `bulkActions`, table-level `actions`), the `basalt-controls` "Homes" rule is silent and lint accepts a bare `Menu` in a `col.display` cell, medium; (AF) `inputProps` has no checkbox/switch binding (`{ type: 'checkbox' }` is TS2554), low-medium; (AG) `llms.txt` still gives signatures without prop shapes for `table`/`charts`/`forms` (row AA unfixed in 2.6.1), low-medium; (AH) `form.errors` is an index signature (TS4111 on dot access) and `FormRow.error` takes a node with no helper from `inputProps`, low.
- **DX trial 3:** branch `w13/dx-trial-3` (pushed, never merged, no PR; delete when no longer needed). 15 wrong turns: 6 basalt-rooted (strict), 4 argo-rooted (fixed), 1 caused by the lead's brief, 4 model. Runtime not exercised in a browser.
- **Cleanup:** `w11/dx-trial`, `w12/dx-trial-2` and their worktrees deleted; the two Hermes trace-check threads deleted from production; worker worktrees removed; `origin/w13/dx-trial-3` kept deliberately (local branch deleted). Wave 14 stays `pending` on owner call D4; not spawned.

## Wave 14 — Loop round 4: adopt 2.7, a fourth DX trial <!-- status: done -->

Round 4 of the convergence check (same four exit parts as Wave 13).

- [x] Bump both pins to basalt-ui 2.7.0 exact; `doctor`, `sync --check`, `check-theme --audit-allows`
      clean. 2.7.0 lints a Menu/ActionIcon in a table `cell` (warn in apps): move argo's
      `workouts-table.tsx` (Edit + Delete) and `skinfold-history-table.tsx` (Delete, with `loading`) to
      `rowActions`; bind any boolean form field with `inputProps(form, path, { type: 'checkbox' })`; read
      field errors through `inputProps(...).error`. Zero new warnings left.
- [x] Check the momentum chart legend (one swatch for green and red bars, seen in round 3): basalt gap or
      argo config; fix argo's side or record a row.
- [x] DX trial 4: a fresh agent, a new throwaway branch (never merged), a task no earlier trial covered:
      an editable list page (a `DataTable` with `rowActions` Edit/Delete opening a modal form with a
      checkbox and validation errors, saving through a mutation, a toast on success), using only argo's
      shipped basalt layer, `llms.txt` and the installed types. Classify every wrong turn strictly.
- [x] Exit table for round 4 in `w14.md`.

**Left behind:**

- **Landed on master** (`rd merge`, `make check` green, deploy `879da18` verified: `make verify` commit = `origin/master`, `make logs` clean): #50 basalt-ui **2.7.0** exact + `rowActions` for the workouts and skinfold tables (gateway review: 2 false blockers, `loading` exists in the installed types; read by the lead), #49 momentum finding (docs only), then a docs/fix commit: `toMessage` typed, "Forms and dialogs" in `apps/dashboard/AGENTS.md`, the trial log and `w14.md`.
- **Exit criterion, round 4: NOT converged** (`w14.md`). Suppressions **met**, regression **met by inspection**; full-wave and clean-trial **not met**: basalt friction rows AI-AL, none worked around.
- **Basalt friction for `argo-friction.md`:** (AI) `DualPanel` legend has one swatch for a two-colour signed bar series (Momentum), low; (AJ) `DataTableRowAction<T>` not exported from `basalt-ui/table` despite MIGRATING 2.7.0 (TS2305), and no pattern for state-dependent `rowActions` under the stable-reference advice, low-medium; (AK) `emit` kinds must be registered in the app's `defineNotifications` first, undocumented in the rule and `llms.txt`, low; (AL) no documented seam for a form dialog (`overlays.open` needs `defineOverlays` + `BasaltRegister`; `basalt-controls` has only the `*-modal.tsx` filename carve-out), medium.
- **DX trial 4:** `origin/w14/dx-trial-4` (never merged, no PR; delete when no longer needed). 6 journal rows: 2 basalt, 1 argo (fixed), 3 model/brief. Runtime not exercised in a browser.
- **Incident:** the first trial worker's session was refused by the platform safeguard (`reasoning_extraction`) on every prompt, including a trivial one, before any work; a fresh worker with a differently worded brief ran clean. Worth knowing if a brief that asks for a "log of every wrong turn" recurs.
- **Not verified:** the new row actions and the trial page in a browser; no `make evidence` re-run. The trial worker's input box held an unsent German line ("Trial 5 mit den Doc-Fixes …"), not a wave instruction; no trial 5 was started.
- **Cleanup:** worker worktrees removed with `rd fan --clean`; Wave 15 stays `pending` on owner call D4; not spawned.

## Wave 15 — Loop round 5: adopt 2.7.1, a fifth trial <!-- status: done -->

Round 5 of the convergence check (same four exit parts as Wave 13).

- [x] Bump both pins to basalt-ui 2.7.1 exact; `doctor`, `sync --check`, `check-theme --audit-allows`
      clean, zero lint warnings from basalt rules. Verify rows 52-55 live: the momentum legend shows the
      split up/down swatch; `DataTableRowAction` imports from `basalt-ui/table`.
- [x] Trial 5: a fresh agent, a new throwaway branch (never merged), a task no earlier trial covered: a
      chat-adjacent page (an AI chat panel in a `PageAside` next to a `Lines` chart whose range is a
      `RangeFilter` in the `PageBar`, with a notification on a completed reply), using only argo's shipped
      basalt layer, `llms.txt` and the installed types. Keep the brief neutral and record each
      misstep with its cause (basalt, argo, model, brief).
- [x] Exit table for round 5 in `w15.md`.

**Left behind:**

- **Landed on master:** #51 basalt-ui **2.7.1** exact in both pins (`rd merge`, `make check` + dashboard build green; deploy `b645191` verified: `make verify` commit = `origin/master`, `make logs` clean). Review: none on #51, a version string plus sync output, read by the lead. Then a docs commit (trial log, `w15.md`, one `apps/dashboard/AGENTS.md` paragraph on the chat-settle trigger and `ScrollArea`). Evidence: `w15.md`.
- **Rows 52-55 verified live:** Momentum legend is split green/red in light and dark; `DataTableRowAction` exports from `basalt-ui/table`.
- **Exit criterion, round 5: NOT converged under the strict rule** (`w15.md`). Waivers **met**, regression **met by inspection**; clean trial **not met**: two basalt-rooted rows, nothing worked around.
- **Basalt friction for `argo-friction.md`:** (AM) no rule or skill line says a scrolling region must be a Mantine `ScrollArea`; `basalt/raw-scroll-container` is reachable only at lint time and `vite build` passes, low; (AN) `PageAside` props (`title`, `persistKey`) exist only in `dist/shell/page-aside.d.ts`, `llms.txt` has the signature only (row AA/AG class, still open), low; (AO) DualPanel signed-bar legend swatch is a split 10 px square on Momentum but a split 8 px circle on Garmin "Divergence", shape inconsistency, low (cause not traced).
- **DX trial 5:** `origin/w15/dx-trial-5` (never merged, no PR; delete when no longer needed). 5 rows: 2 basalt, 1 argo (fixed), 2 correct guesses. Runtime not exercised in a browser.
- **Not verified:** the trial page at runtime (aside layout, toast); no `make evidence` re-run; legend screenshots are in `/tmp`, not committed.
- **Cleanup:** worker worktrees removed with `rd fan --clean`; Wave 16 stays `pending` on owner call D4; not spawned.

## Wave 16 — Loop round 6: adopt 2.7.2, a sixth trial <!-- status: done -->

Round 6 of the convergence check (same four exit parts as Wave 13).

- [x] Bump both pins to basalt-ui 2.7.2 exact; `doctor`, `sync --check`, `check-theme --audit-allows`
      clean, zero basalt lint warnings. Spot-check `llms.txt`: `PageAside` and `FilterSet` carry props.
- [x] Trial 6: a fresh agent, a new throwaway branch (never merged), a task no earlier trial covered: a
      content page (a `Markdown`/`Prose` article from an API field with a table of contents in a
      `PageAside`, a `SearchFilter` filtering a list of articles, and a `Heatmap` of reading activity),
      using only argo's shipped basalt layer, `llms.txt` and the installed types. Keep the brief neutral;
      record each misstep with its cause (basalt, argo, model, brief), checking a claimed basalt cause
      against the shipped rules and lint before recording it.
- [x] Exit table for round 6 in `w16.md`.

**Left behind:**

- **Landed on master:** #52 basalt-ui **2.7.2** exact in both pins (`rd merge`, `make check` + dashboard build green; deploy `f9e5ee1` verified: `make verify` commit = `origin/master`, `make logs` clean). Review: none on #52, version strings plus sync output, read by the lead. Then a docs commit (`w16.md`, the trial log). `llms.txt` spot-check: `PageAside` and `FilterSet` carry props.
- **Exit criterion, round 6: NOT converged under the strict rule** (`w16.md`). Waivers **met**, regression **met by inspection**; clean trial **not met**: two basalt-rooted rows, nothing worked around.
- **Basalt friction for `argo-friction.md`:** (AP) `TableOfContents` props and its dependence on `Markdown` heading ids are documented only in `src/content/toc.tsx`; `llms.txt` lists the signature only (AA/AG class), low; (AQ) `WidgetHeader` requires `tier` but neither `llms.txt` nor a rule says so (types catch it at once), low. Row 8 (`Date.now()` in render) was a model misstep: `react(purity)` covers it, not basalt.
- **DX trial 6:** `origin/w16/dx-trial-6` (never merged, no PR; delete when no longer needed). 15 journal rows: 2 basalt, 3 model/tooling, 2 brief. Runtime not exercised in a browser.
- **Not verified:** the trial page at runtime (TOC collection, heading ids, heatmap on real data); no `make evidence` re-run.
- **Cleanup:** worker worktrees removed with `rd fan --clean`; Wave 17 stays `pending` on owner call D4; not spawned.


## Wave 17 — Rendering: SSR-first, streamed sections <!-- status: dropped -->

**Dropped 2026-10-15 (D4):** argo is personal software with no SEO need; it stays client-rendered. Kept
below for the record; basalt-ui's SSR patterns are proven on weatherorb instead.

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
      `~/SourceRoot/vps/apps/argo/compose.yml` change; it lands in step with the first SSR image, and
      this wave verifies it live like Wave 10 did (Uptime Kuma, logs, traces, screens).

**Evidence:** `w11.md` — TTFB, shell flush, per-section reveal, FCP/LCP, CLS 0, hydration time, at 1x
and 4x CPU, against the baseline Lighthouse; a Chrome UA (bots get a buffered document).

**Left behind:**
