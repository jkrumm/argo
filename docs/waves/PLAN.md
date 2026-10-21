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

# Part 2 — the redesign loop: expression through data (2026-10-17)

**Owner's verdict (2026-10-17):** after basalt Waves 29–33 argo "basically looks the same", and its pages are
"slopped out". The examples: Garmin Health's top boxes with a coloured left border and numbers with no
meaning, Agents, Warden, Calendar. There is no mental concept of how to express each dataset. The owner
wants an **endless loop** of redesign on argo's real pages until they reach the level of Keel Workspace
(`https://keel-workspace.vercel.app`). That is the level of the parts the owner named: expression through
data, a micro-visual chosen per dataset, every number with its unit and context, dense and calm spacing,
composite cards, decision cards, day-grouped timelines, and copy that is only facts.

**The reference, look-only:** Keel's captures are on this machine at
`/Users/jkrumm/SourceRoot/basalt-ui/.design-parity/keel/routes/*--desktop.png` and `.../keel/patterns/`.
Its pattern inventory and measured scales are in `basalt-ui/docs/waves/design-parity/BENCHMARK.md` and
`SPEC.md` (§ 4 is the data-to-expression catalogue). Keel publishes no code and no licence: take ideas, never
assets. **Never commit a Keel image here.**

**What Keel does that argo does not (read this before any page):**

- **KPI tiles.** Caption and qualifier sit on one mono line ("WIN RATE · 90 days", "SPEND · of $9").
  The hero value has a muted unit. Each tile has a micro-visual fitted to its data: a gauge against a
  target, a ring for a rate, a progress bar with a target tick, a tick distribution, segmented spend
  against a budget, events on a time axis. No coloured left edge, ever.
- **Composite cards.** Keel's agent card stacks:
  - an identity and status line;
  - a 2×2 inner panel of different micro-visuals, divided by hairlines;
  - a "Now …" or "Your call …" line;
  - a mode control and one explaining sentence.
- **Decision cards.** The title is a question. Then the entity with its facts (`·`-separated), an
  evidence line with a confidence %, one primary action plus secondaries, and a context preview on
  the right (a draft, a from → to trend, a stage stepper). Never four stacked buttons.
- **Timelines and lists.** Day-grouped, with a time column, the actor with a verb, evidence chips and
  status dots. A heading carries its count, and a "Live" pulse marks streaming data.
- **Copy.** Facts only ("−18 in 14d", "118 → 92"). No filler questions as subtitles ("What did I do?").

**Method, per page (every wave):**

1. Write a concept in `docs/design/<page>.md`: the user's question, the decision the page supports, each
   dataset's shape, and the chosen encoding with its reason. Cite the Keel pattern it learns from.
2. Build it on real data. Use basalt exports first. Missing pieces are prototyped as a local component
   under `features/<page>/` and listed in `docs/design/UPSTREAM.md` (pattern, props, which pages use
   it). The basalt orchestrator moves proven ones into basalt within the same cycle, and argo then
   switches to the import.
3. Run at least three rounds of live shot → critique → revise. Critique on the three axes (craft,
   expression, communication) with the `basalt-design-reviewer` subagent installed by `sync`, plus a
   side-by-side read against the matching Keel capture. A page is done when the reviewer passes it AND it
   holds up next to Keel.
4. Push to master (argo deploys on push), verify `/api/health` reports the commit, live-shot the
   deployed page, and record the before/after in the wave's Left behind.

**Privacy (binding):** argo is a public repo, and its screenshots show the owner's real health, calendar
and agent data. Boards, shots and crops live only in the gitignored `.design-shots/`. Committed docs
(concepts, verdicts, Left behind) carry no real personal values: no body weight, health readings, spend,
lift numbers, counts from live snapshots, names, titles or message text, only `{placeholders}`. Real
values live only in the gitignored `.design-shots/`. Commit concept docs and verdict text with
placeholders, never images or real values.

**Gate (every wave):** `make check` green; every merged diff independently reviewed (two rounds, then scope
frozen and the lead reads the last fix diff); the rounds' verdicts in `docs/design/<page>.md`; the page
live-verified after deploy. The orchestrator copies the boards to the owner's MacBook.

**Mode:** orchestrated from the basalt-ui mother. Leads run on the high wave model. Independent pages run
in parallel as `rd fan` worktrees (disjoint `features/<page>/` and `routes/<page>.tsx`). A lead does NOT spawn
the next wave.

## Wave 18 — Live-data shot harness and the page concepts <!-- status: done -->

- [x] `scripts/design-shot.ts`, run as `make design-shot ROUTES="/garmin-health /agents"`. It builds the
      dashboard with `VITE_API_URL=https://argo.jkrumm.com/api`, serves `dist` on `http://localhost:7715`
      (the one localhost origin the API's CORS allows) inside the script for the run only, and seeds the
      bearer into localStorage `argo-auth` (`{"state":{"token":…},"version":0}`) from
      `ARGO_TOKEN=$(secrets-run read op://common/api/SECRET)`. It never prints, logs or writes the token. It
      screenshots each route at 1440 and 390, dark and light, full scroll height (the shell scrolls an inner
      region, so size the viewport to the content), plus one crop per card or table, into
      `.design-shots/<label>/`. Add `.design-shots/` to `.gitignore`. When basalt ships `shot --api/--header/--local-storage`
      (basalt row 167, in flight), switch to it.
- [x] Baseline every page: `/`, garmin-health, agents, warden, calendar, strength-tracker, walking-pad,
      body-composition, reading, usage-tracking, astro-window, hermes-chat and m365-explorer.
- [x] One concept doc per page (`docs/design/<page>.md`) as in Method step 1. Rank the pages by how far
      they are from the bar. Fill `docs/design/UPSTREAM.md` with the patterns that recur across pages (KPI
      tile micro-visual variants, the inner metric grid, the decision card, the day-grouped timeline, the
      fact strip, the stepper, status-dot lists).
- [x] Owner review point: the orchestrator shows the baseline boards and the concepts. (Boards copied to the owner's MacBook, `~/Downloads/argo-design-review/`, 2026-10-17. The owner's standing directive is an endless loop, so the redesign proceeds; owner feedback is steered in mid-wave.)
      **Left behind:**

  **Stopped: at the owner review point.** Steps 1–3 are done and merged; step 4 is the orchestrator's.
  This wave stays `active` until the owner has seen the boards; nothing was spawned.

  - **Boards (gitignored, local to the mini, copy to the MacBook):**
    - `.design-shots/w18-review/index.html`: the 13 pages ranked by distance, each with the argo
      baseline beside the matching Keel capture and the concept's question, layout, encodings and pass
      criteria. It is self-contained: the Keel images are copied into its `img/`. Look-only, never commit them.
    - `.design-shots/baseline/index.html`: every route (15 incl. the astro tabs) × dark/light ×
      1440/390, 60 full shots, plus desktop crops.
  - **Harness:** `make design-shot [ROUTES=…] [LABEL=…] [SKIP_BUILD=1]` (`scripts/design-shot/`, #57).
    - **Deviation from step 1:** it does not build with `VITE_API_URL` and serve on `:7715`. Instead it
      reuses `make evidence`'s same-origin `/api` proxy, which is GET-only, so there is no CORS
      dependency and no write can reach production.
    - The evidence server now refuses any `Host` other than its own loopback origin, since its HTML
      carries the bearer. Upstream non-2xx responses are recorded as notes on the board.
    - basalt-ui 2.17 has no `shot --api/--header/--local-storage` yet (row 167). Switch to it when it
      ships.
    - Crop gaps: calendar and hermes-chat produce no crops (their surfaces are not cards), agents only 4
      and reading hits the 40 cap. Full shots cover them.
  - **Concepts:** 13 docs in `docs/design/` (`home.md` is the new `/` Today page; `/` still redirects
    to Garmin Health). The distance ranking is in `docs/design/README.md` (5 = furthest: warden, home,
    calendar, walking-pad, m365-explorer). The recurring patterns are in `docs/design/UPSTREAM.md`.
    - Every one of them is still missing from basalt-ui 2.17: `Meter`, the strip, `BarList`,
      `EventList`, `Board` (SPEC §4 waves 34–38, 34 in flight), plus new ones (chart facts header,
      entity card, agenda row, compact `EmptyState`, `foldTopN`).
    - Wave 19 needs `Meter`, the strip, `BarList` and the facts header. It adopts each one that has
      shipped by then and otherwise prototypes it under `features/garmin-health/` with the UPSTREAM
      props.
  - **Review:** every merged diff got two independent rounds, then scope was frozen and the lead read
    the last fix diff: #57 (harness), #58–#61 (concepts), and README + UPSTREAM. `make check` ran green
    in the merge train on every merge. The harness deploy was verified live (`/api/health` commit
    `f0b717f`). The concept merges are docs-only, so no page changed.
  - **For later waves:**
    - The EWMA comments in `apps/api/src/lib/garmin-formulas.ts` (~208–210) and
      `apps/api/src/lib/training-load.ts` (~59) claim 7 d / 28 d half-lives. The constants give
      ≈2.4 d / ≈9.7 d (λ 0.25, 2/29). The concept states the real values; fix the code comments (or
      the constants) in Wave 19.
    - Prerequisites the concepts name:
      - a walking-pad weekly-target setting (new);
      - no `lastSyncedAt` on `/reading` (that cell was dropped);
      - the merged inbox `apps/dashboard/src/lib/decisions.ts` (Waves 20–21);
      - `features/calendar/derive.ts` (Wave 21).
    - Privacy: reviewers repeatedly flagged that the concept docs committed real values (body weight,
      spend, lift e1RMs). Part 2's rule is now tightened: committed docs carry `{placeholders}` only, and
      the concept docs were scrubbed to match.

## Wave 19 — Garmin Health, Agents and Warden, in parallel <!-- status: done -->

Three page workers fan out at once on disjoint files (`features/garmin-health/` + `routes/garmin-health.tsx`;
`features/agents/` + `routes/agents.tsx`; `features/warden/` + `routes/warden.tsx`). A pattern two pages share
(the decision card for Agents and Warden) is built once by one worker. The other worker adopts it after it
merges.

- [x] **Privacy tightening (orchestrator, 2026-10-17):** committed docs carry no real personal values (body
      weight, health readings, spend, lift numbers, names, titles). Use `{placeholders}`; real values live only in
      `.design-shots/`. Scrub the 13 concept docs in one commit first (history stays, by owner choice on the
      basalt side).
- [x] Garmin Health per `docs/design/garmin-health.md`. Use `Meter`, `BarList` and the strip from basalt the
      moment they ship (basalt Wave 34 is landing them now); until then, prototype them under the feature with
      the UPSTREAM props. Fix the EWMA half-life comments.
- [x] Agents per `docs/design/agents.md`: agent cards on the crew anatomy, and the human queue as decision
      cards.
- [x] Warden per `docs/design/warden.md`: decision cards replace the four-button table.
- [x] At least three live-shot rounds per page, scored by the reviewer and against Keel. Deploy, verify
      `/api/health`, live-shot. Update `UPSTREAM.md` with what was proven (props as actually built).
      **Left behind:**

  **Closed out (orchestrated): Wave 20 is marked active but not spawned; the orchestrator spawns it.**

  - **Landed (master, deployed, `/api/health` verified after each merge, last `8c9cdcc`):**
    - Privacy scrub: the 13 concept docs plus `README.md` and `UPSTREAM.md` carry `{placeholders}` only; Part 2's Privacy rule now forbids
      real values in committed docs (`338fa22`, `eb21cbb`).
    - basalt-ui 2.18.0 (`7529cf7`): `Meter` and `BarList` adopted from the package. The short-lived local
      prototype of them (`769a493`, a port of basalt PR #341) was deleted in `dbb45f3`. The port review's
      findings were posted on basalt PR #341, not fixed locally.
    - #62 the shared `DecisionCard` (`components/upstream/decision-card.tsx`), used by Agents and Warden.
    - #65 Agents, #64 Warden, #63 Garmin Health (incl. the EWMA half-life comments; the route
      description and `docs/GARMIN-HEALTH.md` were corrected in `e454282`).
    - `.gitignore` now ignores `node_modules` symlinks (a worker committed one; `8fda93e`).
  - **Before/after:** before = `.design-shots/baseline/<page>--*`; after = the live shots
    `.design-shots/w19-live-garmin-health/` and `w19-live-agents-warden/` (basalt `shot --base` on
    production). The final round boards are `w19-garmin-health-r14`, `w19-agents-r12-basalt` and
    `w19-warden-r12(-basalt)`. All of them are copied to the MacBook,
    `~/Downloads/argo-design-review/w19/`. Before → after per page:
    - Garmin: three left-edge hero cards with bare numbers and eight filler subtitles became a summary
      sentence, a joined strip (recovery meter with zones and contributors as points of their weight,
      zoned ACWR meter, three dated sparkline rows) and fact headers on every chart. Each header names
      its own point's date, so a sync gap never reads as "today". The fitness z-score chart and the
      three-colour activity stack are gone.
    - Agents: three bare tiles and a long table of dash columns became a strip (needs-you trend, oldest-wait
      meter, segmented fleet), decision cards, project cards on Keel's crew anatomy and day-grouped
      narratives. A failed fetch now reads as unknown, never as an empty fleet.
    - Warden: tables with four or five stacked buttons and raw key dumps became a 6-cell health strip,
      decision cards (one primary, one secondary, a menu, a state-history preview) and one board in
      which every item appears exactly once.
  - **Rounds:** Garmin 14, Agents 12, Warden 12. Each is recorded in its `docs/design/<page>.md` under
    "Wave 19 rounds". From round 5 on, rounds were scored on basalt 2.18's `shot` (with `metrics.json`),
    because the local harness gives the reviewer no measured Craft data. The scoring recipe is
    `--api /api=https://<argo-host> --local-storage argo-auth=@env:ARGO_AUTH --auto-anchors`.
  - **Reviewer verdict, stated plainly:** the `basalt-design-reviewer` did not pass every component on
    any page.
    - Agents: the page passes; open defects are the fleet strip type sizes and indistinct grey
      segments, and 390 truncation.
    - Warden: the decision cards and meters pass; open defects are the clipped one-line kickers, the
      per-column board scroll and the Meter caption sizes.
    - Garmin: no full pass in its last scored round (the step is ticked on the Keel read below, not on a reviewer pass).
    - The orchestrator's side-by-side read against Keel (root, crew, record) holds up on all three
      pages, and design scope was frozen there.
    - The residual fails are mostly basalt-side (Meter caption sizes, Button paddings, no Sparkline
      reference) and are filed below.
  - **Code review:** every diff got two independent rounds, then scope froze and the lead read the
    last fix diff (#62, #63, #64, #65, the bump, the scrub). Fixes covered null versus zero
    (fabricated zero fleets, "0 at peak", stale-day headers), exactly-once board placement,
    prototype-key crashes, a PR link nested in a button, and the container-query order.
  - **basalt friction:** 18 rows with the exact prop needed, in `docs/design/UPSTREAM.md` § basalt
    friction (2.18.0). Top asks:
    - `Meter`: multiple `ticks`, a caption `size`, a muted fill;
    - `BarList`: a thin label-outside row and a per-row `max`/tick;
    - `Sparkline`: `reference`;
    - `ChartCard`: `facts`;
    - `relativeTime`: should follow the UI locale (German strings on English pages).
    - Three diverging `StatStrip` prototypes (garmin, agents, warden) are listed for basalt wave 35 to
      converge.
  - **Deviations kept, the owner may revert:**
    - Agents: "Oldest wait" falls back to the oldest human-queue ask when no agent waits, captioned
      `human queue`.
    - Warden: the Fixes bar plots fixed against quiet (the headline percentage's own base), and closed
      appears only as a count. Criterion 4 is marked amended.
    - Hero numerals stay mono (tabular): DESIGN.md wins over the landscape study's
      proportional-figures rule. That conflict is filed as friction.
  - **For later waves:**
    - Deferred refactors, out of scope by freeze:
      - split `features/agents/model.ts`, `features/warden/page-model.ts` and
        `features/garmin-health/strip-cells.tsx` into per-concern view models;
      - move the reusable primitives to `components/upstream/`;
      - pin the dashboard's mirrored Garmin thresholds to the API constants with a test (or serve
        them from the API).
    - `basalt-ui shot`: the Garmin fitness sparkline focus anchor times out about once per run.
    - The managed `basalt-design` skill's live-data `shot` recipe sends production captures to the
      reviewer's provider. This is the accepted Part 2 practice, but a reviewer flagged it; it belongs
      upstream.

## Wave 20 — Calendar and the home page <!-- status: done -->

- [x] Calendar: agenda-first density (empty hours collapse, today's meetings with prep state, the week as
      a compact strip).
- [x] Home `/`: a "Today" overview on Keel's model. What needs you (Warden, Agents), today's meetings, a
      health snapshot and a live activity stream, each with its count.
- [x] At least three rounds; deploy; live-verify.
      **Left behind:**

  **Closed out (orchestrated): Wave 21 is marked active but not spawned; the orchestrator spawns it.**

  - **Landed (master, deployed, `/api/health` verified after each merge, last `c77343b`):**
    - `90c51a9` `BasaltProvider locale="en-GB"`: relative times and formatters read English (owner rule (d)).
    - #66 Calendar: Agenda is the default tab, with a summary sentence, `Today · {n}`, a day-grouped `Next 7 days`, a Monday–Sunday
      `Booked hours` strip on a shared 0–8 h track, a Work/Personal split, a longest-free-block cell, `Tasks due` as a status-dot
      list, and a 3-day list for Week at 390. The legend and the yellow source Alerts are gone. `features/calendar/derive.ts` owns
      every figure. The shared `components/upstream/schedule-row.tsx` and the `calendarWork`/`calendarPersonal` series are registered.
      **API:** optional `from` on `GET /calendar` and `GET /m365/calendar/upcoming` (a real ISO date, or a datetime with an offset;
      the default is still now, so agent callers are unaffected), so past days of the week and this morning's meetings exist.
    - #67 Today at `/` (no Garmin redirect; `Today` nav entry in a new Overview group): a headline sentence, a 5-cell strip, `Needs you`
      cards from the one merged inbox `lib/decisions.ts`, the meetings agenda on `ScheduleRow`, and an activity feed that folds a
      burst of Warden steps on one item into one `from → to` row.
    - #68 / #69 post-live fixes (owner rules found by the live score): a quiet strip fill, a free-block length that matches its
      printed range, `{x} booked this week`, unbreakable durations, no legend swatch that keys nothing, the next meeting named on an
      empty day, the stale threshold stated (`stale ≥ {n} d`), one wait format, and card surfaces on the right column.
  - **Before/after:** before = `.design-shots/w20-r0/` (Calendar: the 15 h empty grid plus a 6-dot legend; `/` redirected to Garmin).
    After = the live shots `.design-shots/w20-live-final/`. Round boards: `w20-calendar-r1…r5`, `w20-calendar-live-r1`,
    `w20-home-r1…r9`. All are under `apps/dashboard/.design-shots/` (gitignored; `basalt-ui shot` requires its out dir inside the
    package) and copied to the MacBook, `~/Downloads/argo-design-review/w20/`.
  - **Rounds:** Calendar 5 + 1 live, Home 9. All scored by `basalt-design-reviewer` on `basalt-ui shot --api/--local-storage
    --auto-anchors`, plus a side-by-side read against Keel's root and the record timeline. Each round is recorded in
    `docs/design/{calendar,home}.md`.
  - **Reviewer verdict, stated plainly:** a fresh reviewer scored the live deploy and did **not** pass every component. It passes:
    Calendar Today and Tasks due; Home summary, show-more and the third decision card (last pre-merge round). The four owner-rule
    fails it found in argo's own code were fixed in #68/#69 and re-shot live. Still open:
    - **basalt-side** (filed): font-size count in the Meter/BandStrip cells, the heading face's slashed zero, `Section`'s mono count
      chip, the Sparkline hover value.
    - **argo-side** (for later waves):
      - the Warden `HistoryPreview` is mono, a Warden-owned file;
      - the activity rows still wrap and repeat the actor and verb (Keel uses one line per event with a glyph);
      - decision cards have no in-place primary verb (Open in Warden only);
      - the agents band still reads as a grey block;
      - Home's ACWR (7 d / 28 d) and Garmin's EWMA ACWR can show different values and verdicts, and neither page says why;
      - cancelled M365 meetings show the provider's German title prefix instead of a cancelled state (needs `isCancelled` from
        the API);
      - Today names no next meeting once all of today's meetings have ended.
  - **Against Keel:** the anatomy now holds: headline sentence, joined strip, decision cards with a preview, counted day-grouped
    lists, a Live feed, and an agenda without empty hours. It is still weaker on glyphs, the primary verb in place, and one-line feed
    rows.
  - **Code review:** #66 and #67 each got two independent rounds (fixes for null-as-zero on a failed source, the phone week's missing
    Sunday, past meetings that never existed, an unchecked "today" on recovery, a restated Warden threshold, fixed-24 h day math, an ask
    dedupe keyed on fields production does not send). Then scope froze and the lead read the last fix diff. #68 and #69 each got one
    independent round, clean with no fixes, so nothing was left for a second round. `make check` ran green in the merge train on every
    merge. agent-gateway's review queue wedged during the wave (jobs pending 20+ min, none running), so every round ran as
    independent subagent reviewers.
  - **basalt friction:** the `w20-calendar` and `w20-home` blocks in `docs/design/UPSTREAM.md`. Top asks:
    - `Meter`: `tone="muted"` (filed again: two pages hand-roll `alpha(VX.muted, .35)`), `size="row"`, multiple `ticks`, a target
      tick visible at `max`, per-segment captions;
    - `BandStrip`: a quiet intensity preset;
    - `Section`: a `live` pulse, a visible period line, a proportional count chip;
    - the heading face's slashed zero;
    - `EventList` with a time column and a trailing action;
    - `StatGroup variant="strip"`: five cells with an odd one spanning.
  - **Deviations kept, the owner may revert:**
    - Today sits in a new one-item Overview group and is not a phone tab (it is under More).
    - Calendar's Week tab at 390 is a 3-day list, not a grid (`WeekView` has no visible-days prop).
    - Work + Personal attributes a minute both calendars hold to Work, so the split sums to the booked total.
    - Any unanswered calendar source blanks every figure on the Calendar page to `—`. If Google's token expires, the whole page
      dashes until re-auth; per-source figures with a "Personal unavailable" note would be softer.
  - **For later waves:** the deferred argo-side items above. Promote `ScheduleRow`, `unanswered` and the strip prototypes upstream
    once basalt ships them. A harness note: a live shot taken right as `/api/health` flips can still catch the old dashboard
    container. The API image reports the commit, but the dashboard image carries no SHA, so wait for the deploy run to complete
    before shooting.

## Wave 21 — Strength, WalkingPad, Body composition, Reading, Usage <!-- status: done -->

- [x] One concept-driven redesign per page, fanned out in parallel. At least three rounds each. Deploy and
      live-verify.
      **Left behind:**

  **Closed out (orchestrated): Wave 22 is marked active but not spawned; the orchestrator spawns it.**

  - **Landed (master, deployed, `/api/health` verified, last `094769a`):**
    - `9ae11b6` / `ea754b6` / `fbf1e3e` the Wave 20 leftover: decision-card state history on `/` and `/warden` read German.
      Cause, basalt's: 2.18's `relativeTime` builds `Intl.RelativeTimeFormat` from the call's own `locale` only, while
      `numberFormat`/`dateFormat` fall back to the provider default. `lib/format.ts` `relativeTime` (`pinLocale`) passes
      `APP_LOCALE`; every argo caller goes through it. basalt's own `SyncButton` hits the same bug in the shell chrome and argo
      cannot wrap it. Filed in `UPSTREAM.md`. Live shots of `/` and `/warden` now read English only.
    - #70 Reading, #71 Usage (API: additive `calls30d` and four `*Prior30d` fields on `GET /usage/headline`, `metric=error_rate`
      on the timeseries), #72 Body composition (log forms moved to `defineOverlays` modals, a goal popover), #73 WalkingPad
      (a weekly target held as a local preference, default stated), #74 Strength (total-tonnage ACWR, verdict inputs on fixed
      windows independent of the page window).
    - Post-live fixes from the fresh live score, all owner rule "no self-contradicting numbers": #77 Strength (one readiness
      value, recency-gated deload signal, a call that never says Push beside an active signal, the momentum window visible),
      #75 Body composition (one coverage-guarded 7 d mean for the header, strip and chart line; the 30 d slope that restated the
      28 d hero is gone), #76 Reading (ratings binned by whole star rounded down, stated).
  - **basalt-ui 2.19.0** (`691576d`, after close-out): bumped and `sync`ed in its own commit; `make check` and the build are green, and the
    deploy is verified. Not adopted yet: 2.19's Meter zone names and captions, the BarList label column, the status dot, ink light/outline
    buttons and the info focus ring. The page prototypes still hand-roll those, so adopting them is Wave 22's first step. The friction
    rows (multi `ticks`, `tone="muted"`, `size="row"`, per-row `max`, `Sparkline reference`, `ChartCard facts`, the `relativeTime` locale,
    `StatStrip`) are basalt Wave 35, in flight; switch to each one, and drop `lib/format.ts`, once it ships.
  - **Before/after:** before = `w21-<page>-r0`; after = the live shots `w21-live` (all five pages plus `/` and `/warden`) and
    `w21-live-final` (the three post-live fixes). Round boards `w21-<page>-r1…r7` (+ `-mock` / `-all` injected-data variants for the
    empty production windows). All under `apps/dashboard/.design-shots/` (gitignored), copied to the MacBook,
    `~/Downloads/argo-design-review/w21/`.
  - **Rounds:** Strength 8 (r0–r7) + 1 live, WalkingPad 6 + populated variants, Body composition 6 + mock variants, Reading 8 + 1
    live, Usage 7. Each scored by a fresh `basalt-design-reviewer` on `basalt-ui shot --api/--local-storage --auto-anchors` at
    least three times, plus the worker's side-by-side read against Keel. Recorded in each `docs/design/<page>.md` under
    "Wave 21 rounds".
  - **Reviewer verdict, stated plainly:** a fresh reviewer scored the live deploy. It passes every **page** as a whole and
    **fails most components**; no page passes component-complete. Passing components: Reading pace and progress cards, Usage
    summary, cache ring and freshness, Body composition empty row. Against Keel: Usage is closest (strip, chart, ranked list);
    Reading and WalkingPad's empty state hold up; Strength and Body composition are weaker.
    - **argo-side, fixed post-live:** the four figure contradictions above.
    - **argo-side, open (for Wave 22's convergence pass):**
      - Usage deltas carry no direction glyph;
      - the cost-by-source area is one source plus six hairlines (fold to top N);
      - two near-identical blues in the tokens chart;
      - saturated sky fills on non-verdict tonnage and cost areas and the billing split;
      - chart tooltips print a raw `Sun Jun 21 2026 22:00` on daily buckets (check whether basalt's default);
      - Strength's sticky page bar covers section titles in crops at 390;
      - bare section titles (`Diagnostics`, `Finished`);
      - the time-read totals and the record header's steps/kcal name no period;
      - Strength's per-lift strip sparklines are hued while the scan table draws the same lifts neutral;
      - the Balance chart's y-axis runs far past its data.
    - **basalt-side (filed):** mono `DeltaBadge` and `BarList` values (owner rule: values are sans); the heading face's slashed
      zero ("3θ days", "2θ26"); `Meter` marker radius 1 (off the radius scale) and four caption sizes; `Sparkline` has no
      `reference`, so no strip sparkline can draw its limit (the limit is stated in visible text beside it instead); the full-page
      `shot` renders blank below the first viewport on long pages.
  - **Code review:** each of #70–#74 got two independent rounds, then scope froze and the lead read the last fix diff. Fixes
    included: null as zero (backlog hours, `0 p`, `0.0 h`, an empty-window error rate, an absent API field read as "no prior"),
    repeated counts derived from one source, a partial week compared with a full one, a 28 d slope beside a newest-minus-oldest
    change, an equal-weight mean of per-lift ACWRs, a rested lift dropping out of the ACWR sums, a "Today" verdict under a past
    page window, and band offsets compared after rounding. #75–#77 each got one independent round plus the lead's read of the last
    fix diff (#76 was clean, so no second round). `make check` ran green in the merge train on every merge.
  - **basalt friction:** `docs/design/UPSTREAM.md` § "Wave 21 — … (consolidated)" merges the five per-page tables. The top asks,
    each hit by four or five pages: `StatGroup variant="strip"` (there are now nine local strip prototypes), `Sparkline reference`,
    `Meter` (`tone="muted"`, `ticks`, `start`/`goal`, a ring `target`), and a proportional value face for `DeltaBadge`/`BarList`.
  - **Deviations kept, the owner may revert:**
    - Strength: an active monitor signal caps the readiness "Push" at Normal, and the summary says so; the concept had monitor keep
      the readiness verdict.
    - Strength: the strip sparklines show the last {n} sessions while the delta is 28 d. Both periods are labelled, because a
      28 d line is empty whenever no recent session exists.
    - WalkingPad: weeks and the streak run on UTC days (the API's buckets) while the hour grid is local at the current offset; both
      are stated on the page. The weekly target is a browser-local preference, not synced across devices.
    - Body composition: the 7 d / 30 d means are day-based from the series, not the API's entry-based `ma7`/`ma30`; the RATE pill
      is neutral (the gold "bulk" tone contradicted a delta moving away from the goal).
    - Reading: Finished is grouped by month across years; days-to-finish is absent because no book has a start date (stated once).
    - Usage: the cache ring is a local SVG (`Meter shape="ring"` takes no target).
  - **For later waves:** the open argo-side items above; Home's ACWR (7 d / 28 d) still differs in method from Strength's
    total-tonnage EWMA and Garmin's EWMA ACWR, and the live score saw Home print a value where Strength prints `—` (stale), so
    one shared ACWR (or each page naming its method) belongs in the convergence pass. A worker ran `git switch` in the main checkout once
    (reverted, nothing lost): briefs should state that every git command runs inside the worktree.

## Wave 22 — Astro window, Hermes chat, M365 explorer <!-- status: done -->

- [x] Adopt basalt-ui 2.19.0's pieces where the page prototypes still hand-rolled them, as its own commit.
- [x] Redesign the remaining pages: Astro window, Hermes chat, M365 explorer, fanned out on disjoint files.
- [x] ~~Re-score every page with a fresh reviewer and against Keel.~~ Moved to Wave 23 (owner, 2026-10-17): the
      convergence re-score waits for basalt Wave 35's props.
      **Left behind:**

  **Closed out (orchestrated): Wave 23 is added as `planned`, not spawned; the orchestrator spawns it once basalt Wave 35 ships.**

  - **Landed (master, deployed, `/api/health` verified after each merge, last `356f6cc`):**
    - `2c17048` the 2.19.0 adoption: `Meter` now captions categorical `segments` itself, so the hand-rolled legend rows under the
      segmented meters on Agents (fleet), Calendar (Work/Personal), Reading (shelf), Usage (billing lanes, share kept in `format`) and
      Warden (fixes, an unknown part reads `—`) are gone; the strength timer drops its `color` override (2.19 light/outline buttons are
      ink). Not adoptable: `StatusDot`/`StatusVerdict` ship under `dist/theme/` but are not in the package `exports` (filed); the BarList
      label column needed no code change; argo had no info focus-ring workaround to delete. Two independent review rounds (fixes: lanes
      under $0.50 dropped from the bar so it no longer summed to the total, the lost share, a fixed/quiet `null` that vanished).
    - `c5af76f` `.design-shots/` is ignored at any depth (a fan-out worktree showed `apps/dashboard/.design-shots/` untracked).
    - #78 Hermes chat: summary sentence, counted type chips (plus `Untitled` and `Archived`), search, day groups `Pinned` / `Today` /
      `This week` / `Earlier` with counts and a `Live` marker, untitled threads folded into one row with a confirmed `Delete all untitled`
      (pinned and under-a-minute threads excluded), the Hermes health dot in the `PageBar`, a record header with pin / archive / unarchive /
      delete, `?thread=` addressing. The message renderer, stream and voice paths are unchanged; auto-speak moved to a per-thread
      `ThreadSpeaker` so a reply that finishes while the list is open is still spoken.
    - #79 M365 explorer: the 824-line page split into per-concern files; summary, a 3-cell strip (labeled as the intersection with the
      loaded chats + channels, the 50-chat basis stated, a failed team stated as `≥{n}` with Retry), `Chats | Teams | Agent feed` tabs,
      view-scoped neutral tag chips, a master–detail with the labelled sources by tag as the resting right pane, a record header with a
      `Label as…` popover (Copy source id kept), a message list, the Agent feed over `GET /m365/important`, a push sheet at 390, staggered
      per-team channel fetches.
    - #80 Astro window (squashed on merge: an intermediate formatter run had rewritten 45 unrelated docs; reverted before the squash):
      Tonight is a summary, a verdict card that draws the gap to the core gate as a length, a gates card, a 10-night strip whose cells
      name the first killer or the window, a five-cell Night anatomy card (Sky on a scaled `LP.*` track) and the score list; the 20-row
      facts table, the empty `SCORE` block and the filler subtitle are gone. Forecast titles carry facts; the panorama glow is quieter
      (its own fill opacity; the `LP.*` table in DESIGN.md is unchanged); the map drawer copy is one line per option. **API (additive):**
      per night `gateCoreAltitude` + `coreGateDeg` (the dark sample closest to clearing the per-sample gate, the same sample the core
      killer now names), top-level `bestDate` and `moonMaxIllumination`, so the dashboard mirrors no threshold; documented in
      `docs/ASTRO-WINDOW.md`.
  - **Before/after:** before = each page's `w22-<page>-r0` (Hermes: `w22-hermes-r1`). After = the live shots `w22-live-astro`,
    `w22-live-hermes-m365` and `w22-live-step1` (the five pages the 2.19 adoption touched). Round boards `w22-astro-window-r1…r7`
    (+ a pinned-clock fixture variant for the GO states, never committed), `w22-hermes-r1…r7`, `w22-m365-r1…r5`. All under
    `apps/dashboard/.design-shots/` (gitignored), copied to the MacBook, `~/Downloads/argo-design-review/w22/`.
  - **Rounds:** Astro 7 (r0–r7, r6 and r7 scored live and on the fixture), Hermes 7, M365 5. Each scored by a fresh
    `basalt-design-reviewer` on `basalt-ui shot`, recorded in `docs/design/<page>.md` under "Wave 22 rounds".
  - **Reviewer verdict, stated plainly:**
    - Hermes: every component and both pages pass (r7).
    - M365: every component passes except `source-list` (titles wrap to two lines at 390 — kept, the ellipsis was the r2 fail — and one
      or two focus shots time out on the slow Graph upstream). The dark-desktop page timed out in r5 and was last scored in r4.
    - Astro: verdict card, strip, score card, cloud layers and both pages pass; still failing: the gates card's font-size count, chart hover
      tooltips spilling over the next card, sticky bars clipping crops at 390, the GO window stated three times (summary, headline, timeline
      title) and the panorama's "above the gate" minutes differing from the window length by a few minutes (sampling grid vs the engine's
      window; a self-contradiction to fix first in Wave 23). A terrain-gated night was never on a shot.
  - **Against Keel** (the workers' side-by-side reads, plus the orchestrator's read of the live dark-desktop shots against Keel's `crew`
    capture): the anatomy holds on all three (a fact sentence, a joined strip, counted day-grouped lists, neutral meters), but none
    reaches Keel's density or polish yet. The orchestrator's live read found these, all argo-side and open:
    - Astro: the headline `{n} of 10 nights usable` is small beside Keel's hero sentence and still renders the heading face's slashed
      zero; with every night out the strip is ten identical `core low` cells (criterion 3 holds, but a per-night gap bar would carry
      information); the gates card leaves a tall empty column beside the timeline; the site select clips its label; the anatomy's sky
      qualifier wraps and clips at 1440.
    - Hermes: the summary line sits flush under the shell header with no top inset; the type chips are mono uppercase.
    - M365: the Chats-view `Labeled {n}` chip (chats only) beside the strip's `{n} of {total} sources` (chats + channels) reads as two
      different counts for one thing; zero-count tag chips are noise in a view; the right pane shows stacked, gapped scrollbar thumbs; the
      header refresh is still a labelled button, not the concept's icon + `synced {age}`.
  - **Code review:** every diff got two independent rounds from fresh subagents with no shared context (agent-gateway was down), then scope
    froze and the orchestrator read the last fix diff. Fixes included: a pinned untitled thread deleted by `Delete all`, a one-way archive,
    navigation after a failed delete, chip counts that did not equal their rows, a DELETE 404 that blocked the fold forever, auto-speak lost
    for threads not open (Hermes); a labeled count larger than its total, a failed team query read as loading forever, a stale persisted tag,
    silent write failures, a test that passed only on 2026-10-17 because one path read the system clock (M365); a reversed transparency scale,
    a gate figure from a different sample than the gate's own predicate, gate and gap rounded differently, a best night guessed from reason
    text, mirrored moon and core thresholds, a site switch pairing the old night with the new site (Astro). `make check` ran green in the
    merge train on every merge.
  - **basalt friction:** `docs/design/UPSTREAM.md` § "Wave 22 … (consolidated)". Top asks: the `StatusDot` root export (every page now
    carries a local dot), `StatGroup variant="strip"` (eleven local strips), `EventList` with day groups / live marker / glyph / hover
    control / fold, counted filter chips, a master–detail shell, and `Meter` `stops` + `ticks` + `tone="muted"`.
  - **Deviations kept, the owner may revert:**
    - M365: the active tag chip is neutral, not accent (basalt's "selection never takes the accent" wins over the concept's criterion 3);
      the remove control shows on hover/focus (always on coarse pointers); write failures show inline, not as toasts (a toast kind lives in
      `lib/notifications.ts`); view, tag and search live in a local store, so the view is not URL-addressable.
    - Hermes: the health dot is a `PageBar` custom action (no meta slot); no `New chat` button (the composer starts one); a thread opens via
      `?thread=`, not inline; archived threads hide behind an `Archived {n}` chip.
    - Astro: the "Why not" column became a gates card listing all three hard gates; the cloud bars are muted, not the severity ramp; the
      verdict, gates, timeline, anatomy and score all follow the selected night, while the strip marker and summary name the API's best night.
  - **For later waves:** the open items above; `apps/dashboard/src/lib/notifications.ts` needs an `m365:error` kind before M365 write
    failures can toast; the shot harness's focus anchors time out on slow upstreams and hidden mobile panes (each costs 30 s).

## Wave 23 — The convergence re-score <!-- status: done -->

Spawn only after basalt Wave 35 ships its props (`StatGroup variant="strip"`, `Meter` `ticks` / `tone="muted"` / `size="row"` /
`stops`, per-row `BarList` `max`, `Sparkline reference`, `ChartCard facts`, the `relativeTime` locale fix, the `StatusDot` root export,
`EventList`). First adopt each shipped prop and delete the matching local prototype (one commit per export; drop `lib/format.ts`'s
`relativeTime` wrapper once basalt honours the provider locale), then re-score.

basalt-ui 2.20.0 shipped Wave 35 on 2026-10-18. `EventList` did not ship (a basalt Wave 36+ item); keep the local one.

- [x] Adopt basalt 2.20.0 per `docs/design/basalt-2.20-adoption.md` (bump, `sync`, delete each prototype for its export, one
      commit per export). `make check` green, then live-shoot Garmin, Agents, Warden and Home and score them with a fresh
      `basalt-design-reviewer`. Report the argo line delta and file every gap as an `UPSTREAM.md` row.
- [x] Re-score every page with a fresh reviewer and against Keel. Every page still below the bar gets a Wave 24+ in this shape. The
      loop ends only when a fresh scorer and the owner find nothing worth improving.

What to re-score, page by page (the open items each re-score must check first):

- `/` Today: the activity rows' wrap and repeated actor/verb (Keel: one line per event with a glyph); no in-place primary verb on the
  decision cards; the ACWR method differing from Strength's and Garmin's.
- Garmin Health, Strength, Home: one shared ACWR, or each page naming its method (Home showed a value where Strength showed `—`).
- Agents: the fleet band as a grey block; 390 truncation; the 2.19 segment captions under the fleet meter.
- Warden: the mono `HistoryPreview`; clipped one-line kickers; per-column board scroll; the fixes meter's new captions.
- Calendar: the Work/Personal meter's 2.19 captions; cancelled M365 meetings (needs `isCancelled` from the API); no next meeting named
  once today's have ended.
- Strength: the sticky page bar over section titles at 390; hued strip sparklines vs the neutral scan table; the Balance chart's y-axis.
- WalkingPad, Body composition: compact empty states; the record header's steps/kcal period.
- Reading: the shelf meter's 2.19 captions; bare section titles (`Finished`).
- Usage: delta direction glyphs; the cost-by-source fold to top N; two near-identical token blues; saturated non-verdict fills; raw
  `Sun Jun 21 2026 22:00` tooltips on daily buckets; the billing meter's 2.19 captions with the share in `format`.
- Astro window: the panorama minutes vs the window length; the GO window stated three times; the gates card's font sizes; tooltip spill; a
  terrain-gated night on a shot.
- Hermes chat: the Pinned / Today / streaming states on real data (the live account had none).
- M365 explorer: `source-list` at 390; the dark-desktop page and focus anchors on the slow upstream; the view-scoped `Labeled` chip vs
  the strip's all-sources count; zero-count chips; the right pane's scrollbar; the refresh control.
- Hermes chat (craft): the summary line's top inset; mono uppercase type chips.
- Astro window (craft): the slashed-zero headline; per-night information in an all-out strip; the empty column beside the timeline; the
  clipped site select.

**Left behind:**

**Closed out (orchestrated): Wave 24 is added as `active`, not spawned; the orchestrator spawns it.**

- **Landed (master, deployed, `/api/health` verified, last code commit `e0fdcd0`):**
  - Step 1, the 2.20.0 adoption: `84c3379` bump + `sync`, `891ff50` astro `StatusDot` (2.20's `basalt/shadow-basalt-export`
    lint failed on the two local `StatusDot`s; the Hermes one was an icon and is now `StatusIcon`), #81 agents + warden, #82 garmin
    - calendar, #83 home + strength + body composition + walking pad, #84 reading + usage + astro + m365 + hermes, `c5670de` the
      `relativeTime` wrapper deleted (`lib/format.ts` keeps only `APP_LOCALE`; a test pins that basalt follows the configured locale).
      **Line delta: `apps/` +1500 / −3424 (net −1924).** Deleted: every local strip prototype (garmin, agents, warden, home,
      walking-pad, body-composition, strength, reading, usage, m365, astro Night anatomy) for `StatGroup variant="strip"`,
      `FactsLine` for `ChartCard facts`, the local status dots, the muted fills and caption-null pairs the export covers, all redundant
      card insets. Not deletable (each a row in `UPSTREAM.md` § "Wave 23 — basalt-ui 2.20.0 adoption"): `CacheRing` (no ring tick),
      `SkyScale` (no `stops`), per-zone/segment muted fills, Meter caption-null pairs that must keep zone labels, the strip's missing
      `action` / pill / context / `state` slots, facts that cannot dim or take a tone.
  - Step 2, the re-score: #85 warden, #86 home + agents, #87 calendar + strength + walking pad + body composition + reading, #88 astro
    - m365, #89 usage + hermes (round-1 fixes; `apps/` +1258 / −592, mostly new tests and model helpers). What each fixed is in
      `docs/design/<page>.md` § "Wave 23 rounds".
- **Rounds:** r0 (`w23-r0-core`, the four core pages right after the bump), r1 (all 13 pages after step 1), r2 (all 13 after the
  fixes). Live production, `basalt-ui shot --base https://argo.jkrumm.com` with the `argo-auth` localStorage seeded from
  `secrets-run read op://common/api/SECRET` via env (never printed or written), 1440 + 390, both schemes. Each round scored by fresh
  `basalt-design-reviewer`s plus a Keel side-by-side. Boards in `.design-shots/w23-*` (gitignored), copied to the MacBook,
  `~/Downloads/argo-design-review/w23/`.
- **Reviewer verdict, stated plainly (r2):** **pass** — Hermes chat, WalkingPad, Body composition (every component and page).
  **Fail** — the other ten. Basalt-owned only: Garmin Health (Meter tick / zone-label placement), Calendar (four sizes from list
  defaults). Argo items remain on Home, Agents, Warden, Strength, Reading, Usage, Astro, M365 (Wave 24). r1 had every page failing.
- **Against Keel (r2):** holds up — Garmin, Reading, Usage (mostly), Home (mostly), Calendar (mostly), Body composition (close);
  does not yet — Agents, Warden (weakest), Strength, Astro, M365 (rougher), Hermes (an empty page below three rows). The shared gap:
  no page opens with Keel's headline sentence + fact line; argo's summaries are body-size text.
- **Code review:** every PR got two independent agent-gateway review rounds, then scope froze and the lead read the last fix diff.
  Real bugs caught: cancelled all-day events still counted and "all cancelled" over a live all-day item (calendar), a shortcode
  regex that ate `m365:auth:prod`, a needs-you count with a second rule, navigation verbs turned into buttons (home/agents), tag
  chips pruned while teams were still loading, the terrain-ridge reason dropped from the core gate (m365/astro), a bare-decimal cost
  readout, index-joined verdict bars, `+NaN s` deltas (usage), `New → New` creation rows and recased `GitHub`/`OOMKilled` labels
  (warden), a worker report claiming a fix it had not made (strength `dashed: PR`). Recurring false positive, rejected every round:
  "import `relativeTime` from the wrapper" (2.20 honours the provider locale). `make check` ran green in the merge train on every merge.
- **basalt friction:** `docs/design/UPSTREAM.md` § "Wave 23" (three tables: the adoption gaps, round 1, round 2). Top asks: the
  `Button` `rightSection` inset (5.33 px, off-scale — the most frequent failure on agents and warden), Meter zone-label and end-tick
  placement, sticky clearance = page-bar height, the chart tooltip name column, y ticks outside the plot, a strip cell `state` /
  `action` slot, `ChartCard facts` stale/tone, the heading slashed zero outside `h1`–`h6`, and the shot harness (tall anchors blank
  below one screen, fixed chrome over crops, focus timeouts).
- **Deviations kept, the owner may revert:** warden board columns are uncapped (the per-column scroll was the listed defect; a busy
  column now makes the page tall); the calendar detects cancellation by title prefix until the API carries `isCancelled`; strength
  lift sparklines are neutral (one metric per cell, hue not earned); Home ACWR applies Garmin's visibility rule, so before 22:00 it
  may show yesterday's reading and says so.

## Wave 24 — Re-score round 3: the argo items r2 left <!-- status: done -->

Same shape as Wave 23 step 2 (fan-out on disjoint page files, two independent reviews per PR, `rd merge`, live re-shoot, a
fresh `basalt-design-reviewer` + Keel side-by-side per round). Basalt-owned items wait for basalt (UPSTREAM.md § "Wave 23").
The list below is r2's argo-owned residue; each page's detail is in `docs/design/<page>.md` § "Wave 23 rounds".

- [x] Fix the argo items per page, fanned out:
  - Home: activity headlines ellipsize mid-transition; the decision-card history log wraps at 1440 (one-line latest
    transition or an evidence preview).
  - Agents: needs-you readout unit; the stretched half-empty fleet cell; a decision-card title ellipsis; the project-card mini
    bar caption; the activity-strip footer unit; a headline sentence.
  - Warden: ≤3 font sizes on every decision/failed card; a desktop reason expander; the `reverts` definition; a Keel-style
    board (empty columns collapsed, a 390 layout and anchor); a history preview that does not wrap.
  - Strength: readiness card at ≤3 sizes and titled by its subject; the velocity panel's single tick; "stars" vs dots;
    `Composite, all time` as a noun.
  - Reading: the shelf cell (footer fact or no stretch); the title-link focus box; time-read labels outside the bar.
  - Usage: the cache-hit cell's sparkline + delta; the billing footer noun; health x ticks and verdict-bar contrast; the
    freshness word.
  - Astro: a per-night shortfall bar (or none) instead of identical bars; a 390 strip scroll cue; the half-empty core cell;
    the panorama minutes vs the window and the GO window stated three times (shoot the Forecast tab and a GO fixture).
  - M365: the labeled pane's fragmented thumb; a noun for the labeled cell; detail and labeled panes reachable at 390.
  - Calendar: the API `isCancelled` field (replace the title-prefix stopgap). Hermes: pills visible in light.
- [x] Every page opens with a headline sentence + fact line (Keel's shared gap): one shared pattern, not thirteen.
- [x] Re-shoot all pages live and re-score; any page still below the bar gets a Wave 25 in this shape. The loop ends only when a
      fresh scorer and the owner find nothing worth improving.

**Left behind:**

**Closed out (orchestrated): Wave 25 is added as `active`, not spawned; the orchestrator spawns it.**

- **Landed (master, deployed, `/api/health` = `1e93733`, deploy workflow green):** `bfca9a4` + `03278a4` the shared
  `components/upstream/page-summary.tsx` (`PageSummary{sentence, facts?, aside?, loading?}`, Keel's headline + mono fact line,
  an `UPSTREAM.md` row), then six fan-out PRs, each with two independent agent-gateway review rounds, scope frozen after round 2
  and the last fix diff read by the lead: #91 warden (≤3 type steps via `StatusDot` + word, a measured reason expander, the
  `reverts` definition, a board that folds empty columns into one line, a one-line history preview with the true earlier count —
  Home gets it too), #93 home + agents (subject/outcome activity rows, units on every readout, fleet footer, whole decision
  titles with a `Full ask` disclosure, a feed-aware aside), #90 garmin + walking pad + body composition (headlines, encoding
  prose removed from tooltips), #92 astro (window stated once, per-night bars — window length for usable nights, shortfall on
  the core gate — a 390 scroll cue, closest night from the unrounded gap), #94 strength + reading + calendar (**`isCancelled` on
  the API's calendar events** — Graph `$select`, Google `status` — with a title-prefix fallback for a dashboard ahead of the API;
  readiness card, momentum in %/mo, shelf footer, thin time-read bars), #95 usage + m365 + hermes (cache trend + delta, billing
  noun, health ink order and ticks, a freshness word with tone, m365 phone panes via a `pane` store field, hermes pill
  contrast). **Line delta: `apps/` +2309 / −1075.** Every page opens with `PageSummary` except WalkingPad's empty window.
- **Code review:** real bugs caught: `+n earlier` counted the 3-item slice; a stale-snapshot headline beside live-looking facts;
  a forever-skeleton when no snapshot exists (warden); an empty fleet read "every agent working"; the outcome flex factor
  inverted, clipping the transition it was meant to protect (home/agents); off-screen count in mixed coordinate spaces; the API's
  `bestDate` (first night when all are out) labelled "closest"; "highest of the night" on a daylight transit (astro); live
  meetings stripped of a `Canceled:` title and blank titles (calendar); a streak of 0 on a failed query (walking pad); a selected
  record hiding the agent feed (m365). Rejected: `--vx-ink2` "not a token" (it is), `recentMean` over the last 7 readings (a
  calendar window is the intent). `make check` green in the merge train on every merge.
- **Round `w24-r1`** (live production, `basalt-ui shot --base https://argo.jkrumm.com`, `argo-auth` seeded from
  `secrets-run read op://common/api/SECRET` via env, 1440 + 390, both schemes; 1292 shots, one harness focus timeout). Boards:
  `.design-shots/w24-r1-{a,b,c}` (gitignored), copied to the MacBook, `~/Downloads/argo-design-review/w24/`. Scored by three
  fresh `basalt-design-reviewer`s plus a Keel side-by-side; per-page verdicts in `docs/design/<page>.md` § "Wave 24 round".
- **Reviewer verdict, stated plainly:** **pass** — Hermes chat (all but an invisible light row hover). **Fail** — the other
  twelve. The failures moved: the r2 items are fixed, and what is left is mostly **copy** (captions and info tooltips that narrate
  the drawing, undefined terms, missing nouns and units), **empty and missing states** with no reason or next step, a few
  **micro-visuals that answer nothing** (needs-you and p95 sparklines, meters with no gate), and **truncation** (warden/home
  `Latest change`, long identifiers in reasons). Basalt-owned rows: `UPSTREAM.md` § "Wave 24".
- **Against Keel:** holds up — Garmin, Calendar, Body composition, Reading, Usage; close — Home, Warden (the biggest move),
  Strength, Astro, M365; does not yet — Agents, WalkingPad, Hermes. The shared headline closed the shared gap on 12 of 13 pages.
  The next shared gap is the **card interior**: decision cards with prose titles and mostly empty `Latest change` wells instead of a
  question + 2–3 facts + evidence; dash tiles with sentence captions where Keel dims a tile; empty pages (WalkingPad, Hermes).
- **Not verified:** the Hermes Pinned / Today / streaming states (still none on the live account); a GO night on a shot (none in
  the window); the m365 detail and labeled panes at 390 (no anchor there).
- **Deviation kept, the owner may revert:** Warden's `total` rides as a property on the transition array (changing
  `Decision.history`'s shape would have crossed into Home's files mid-wave).

## Wave 25 — Re-score round 4: copy, empty states, card interiors <!-- status: done -->

Same shape as Wave 24 (fan-out on disjoint page files, two independent reviews per PR, `rd merge`, live re-shoot, fresh
`basalt-design-reviewer`s + a Keel side-by-side). Basalt-owned items wait for basalt (`UPSTREAM.md` § "Wave 23" and § "Wave 24").
Each page's detail is in `docs/design/<page>.md` § "Wave 24 round".

- [x] Fix the argo items per page, fanned out:
  - Copy sweep, every page: no caption, footer or info tooltip that narrates the drawing (strength lift strips and four section
    tooltips, reading ratings/pace/finished notes, usage cost/tokens/health tooltips and raw field names, astro Forecast tooltips,
    the agents strip "shade is share" caption); define ACWR, INOL, the readiness score where they first appear; label azimuths;
    no restated legends or headers (agents fleet + activity strip, calendar Today card, body-composition chart header, usage `fresh`).
  - Empty and missing states state why and when it fills (home/garmin recovery, budget, warden board); WalkingPad's empty window
    keeps its headline and a dimmed KPI row instead of an 80 % blank page.
  - Micro-visuals that answer nothing: the needs-you and p95 sparklines, the warden verdicts meter, astro core/cloud cells without
    a gate, the unlabelled second sky-ramp marker, the panorama's 0–50° domain.
  - Truncation and overflow: warden/home `Latest change` (state names whole), long identifiers and URLs in reasons, raw emoji
    shortcodes in warden source lines, quiet-project ages, home actor names.
  - Astro headline noun (`in the next {n} nights`) and the closest night's shortfall; `OUT` with a dot; source dots with a word.
  - M365: one labeled count across headline and strip; detail/labeled panes anchored at 390; the restated `Sources` heading.
  - Body composition: a sentence headline; anchor the 28 d rate and the 7 d verdict to their windows.
  - Reading: an outline focus ring on title links (not the 2 px bar). Hermes and m365: a visible light-scheme row hover.
- [x] Card interiors (the Keel gap): decision cards on Agents, Warden and Home open with a question, 2–3 facts and an evidence
      line, and the `Latest change` well collapses when it has one line; one shared change in `components/upstream/decision-card`.
- [x] Re-shoot all pages live and re-score; any page still below the bar gets a Wave 26 in this shape. The loop ends only when a
      fresh scorer and the owner find nothing worth improving.

**Left behind:**

**Closed out (orchestrated): Wave 26 is added as `active`, not spawned; the orchestrator spawns it.**

- **Landed (master, deployed, `/api/health` = `81f2f0d`, deploy workflow green):** six fan-out PRs, each with two independent
  agent-gateway review rounds, scope frozen after round 2 and the last fix diff read by the lead, landed by `rd merge` with
  `make check` green after every rebase: #96 strength + reading + calendar (one source per term definition, thresholds interpolated
  from the constants, `callFacts`, a ring focus on title links, no Today card repeating the headline), #97 garmin + walking pad +
  body composition (pending / failed / missing as three states, a `useLastWalk` state, a sentence headline with dated windows),
  #98 usage + m365 + hermes (one `labeledCount`, plain-word tooltips, worded warn/bad days, an ink-wash row hover, a capped
  list-end note), #99 agents (question/facts/evidence cards, observed-coverage footers, `startedAt`-only run length), #100 astro
  (one headline gate, the tier word, a fitted panorama domain, the window stated with its missed gate), #101 the shared
  `DecisionCard` interior (`cardCopy` / `capFacts`, `evidenceLine`, `previewPlacement`, additive) + warden + home (shortcodes
  stripped once in `lib/text.ts`, summing legends, empty states with a next step). **Line delta: `apps/` +3513 / −1208.**
- **Code review:** real bugs caught: failed queries shown as factual data gaps (garmin recovery, walking pad "no walks yet",
  body-comp rate); a 24 h claim over one observed hour and unmeasured hours counted as idle (agents, home); `lastActivityAt` shown
  as a run length; a human-queue ask attributed to the producer machine; two labeled counts on one page (m365); an "every thread"
  claim past the 200-thread cap (hermes); `GO` on marginal/poor nights, a window hidden on a moon-gated night while the plot drew
  it, a clearance colour against the ridge instead of the gate, a fitted domain that gapped the sun and moon (astro); a shortcode
  leak into Home; `Decide on Should …?`; quiet items counted as resolved; INOL and ACWR definitions that disagreed with the API.
  Rejected: a `cloud` gate (the API scores cloud, it never gates — `astro-score.ts` factors only).
- **Round `w25-r1`** (live production, `basalt-ui shot --base https://argo.jkrumm.com`, `argo-auth` seeded from
  `secrets-run read op://common/api/SECRET` via env, 1440 + 390, both schemes; 1299 shots, 9 focus-state harness timeouts).
  Boards: `.design-shots/w25-r1-{a,b,c}` (gitignored), copied to the MacBook, `~/Downloads/argo-design-review/w25/`. Scored by
  three fresh `basalt-design-reviewer`s plus a Keel side-by-side; per-page verdicts in `docs/design/<page>.md` § "Wave 25 round".
- **Reviewer verdict, stated plainly:** **fail — all thirteen pages** (Hermes too, which passed w24-r1: a mid-word summary cut and a
  count printed three times; Usage passes at page level). Every w24-r1 item named in this wave moved; the reviewers scored harder on
  copy and found the next layer: **restatement** (a headline, a card and a strip printing the same figure — calendar, reading,
  body composition, warden, m365, hermes, astro), **undefined terms** still left (ACWR on strength, `DOTS`, `30d MA`, `Idle`,
  `tier`), **cells stretched by `StatGroup`** (garmin/home recovery, warden unattended, usage p95, astro core), and **values that
  disagree across cards** (astro core altitude, warden board vs needs-you, m365 labeled). Basalt-owned rows: `UPSTREAM.md`
  § "Wave 25".
- **Against Keel:** holds up — none; close — Home, Garmin, WalkingPad (up), Body composition, Calendar, Usage, M365; does not yet —
  Agents, Warden (down: the question bar exposes the titles), Strength, Reading, Astro, Hermes.
- **The finding that changes the plan:** a decision question cannot be derived from prose. `cardCopy` / `questionOf` produce
  `Approve {raw commit subject}?` or ask prose, because Warden items and agent asks carry no question — only a title, a reason and
  free text. Keel's titles are authored. The producers (Warden's snapshot, agent-gateway's overview/human queue) should emit a short
  `question` field; argo reads it when present and keeps `cardCopy` as the fallback. That is a payload change in two other repos —
  an owner call, not done here.
- **Not verified:** the m365 detail and labeled panes at 390 (the new phone anchor did not register); the ACWR tooltip on the call
  card (no shot state); focus states on 4 anchors (harness timeouts).
- **Deviations kept, the owner may revert:** Strength's call card is a local `Card`, not `DecisionCard` (the evidence slot's inset
  was the grey well); `headlineOf` (home/lib) and `questionOf` (agents) and `cardCopy` (shared) are three question rules — unify in
  Wave 26.

## Wave 26 — Re-score round 5: restatement, terms, authored questions <!-- status: done -->

Same shape as Wave 25 (fan-out on disjoint page files, two independent reviews per PR, `rd merge`, live re-shoot, fresh
`basalt-design-reviewer`s + a Keel side-by-side). Basalt-owned items wait for basalt (`UPSTREAM.md` § "Wave 23"–"Wave 25").
Each page's detail is in `docs/design/<page>.md` § "Wave 25 round".

- [x] One question rule in argo (`cardCopy`; `headlineOf` and `questionOf` route through it), reading an optional `question`
      field when a producer sends one. The producer change (warden + agent-gateway payloads emit an authored `question`) is
      queued for the owner (orchestrator, 2026-10-18); this wave does not touch those repos.
- [x] Fix the argo items per page, fanned out:
  - Restatement, every page: each figure printed once — headline, facts line, cards and strips never repeat each other
    (calendar free/booked hours, reading pace/backlog/time-read, body-comp rate/weight, warden summary vs strips, m365 counts,
    hermes thread count, astro core miss ×3, home meetings, garmin recovery sentence).
  - Undefined terms: ACWR on strength's headline and call card, `AMRAP`, `DOTS`, `30d MA`, `Idle`, `tier`, `dome mag`, the `8 h` target.
  - Values that disagree: astro core altitude across tabs and `next {n}` counts; warden board vs needs-you and the closed totals;
    m365 labeled count vs chip; hermes summary cut.
  - Stretched cells: stop the stretch locally where argo can (a footer fact, a visual that answers the cell) until `StatGroup` ships
    per-cell alignment; usage p95 needs a visual with a limit line or a shorter cell.
  - Decision cards: two actions where one exists today, the preview kept at 390, the multi-transition well sized to its lines, no
    character counts, no command block as decision content.
  - Truncation: home activity names, warden test identifiers and `Blocker` wrap, calendar task titles, astro site select, quiet-project ages.
- [x] Re-shoot all pages live and re-score; any page still below the bar gets a Wave 27 in this shape. The loop ends only when a
      fresh scorer and the owner find nothing worth improving.

**Left behind:**

**Closed out (orchestrated): Wave 27 is added as `active`, not spawned; the orchestrator spawns it.**

- **Landed (master, deployed, `/api/health` = `1e1fc7d`, check + deploy workflows green):** five fan-out PRs, each with two
  independent agent-gateway review rounds, scope frozen after round 2 and the last fix diff read by the lead, landed by `rd merge`
  with `make check` green after every rebase: #102 garmin + walking pad + body composition, #103 strength + reading + calendar,
  #104 astro (API: additive `killers[].cause` — `ridge | floor | never-rises` —, `factors[].ruinous`, `nights[].gateSampleTime`;
  the UI renders them instead of inferring causes from prose; `docs/ASTRO-WINDOW.md` updated), #105 usage + m365 + hermes,
  #106 the one question rule (`lib/question-copy.ts`: authored `question` → own first-sentence question → title question → a plain
  question from kind and state; `authoredQuestion(unknown)` guards every producer path; `question` documented, optional and open,
  on the warden and agents ingest schemas) + agents + warden + home (one `waitingOnOwner` list behind the Warden summary, the
  board text and Home). Then `1e1fc7d`, a lead fix: #103's `dayLabel` used `Intl` month abbreviations, which print `Sept` on the
  CI runner's ICU (and in en-GB browsers) — local `make check` passed, CI `check` failed on master for nine pushes until the fix;
  the deploy went out regardless (the deploy workflow does not wait on `check`).
- **Code review:** real bugs caught: a non-string producer `question` would throw in render and take down Agents and Home; the
  astro card asserted a client-side low-cloud threshold, a regex-derived core cause, a moon "behind the skyline" claim on passing
  nights and a dark window the engine never produced; a reading headline pairing a this-year count with an all-time median; unsorted
  slowest/fastest paces; the usage "30 d mean" over 29 full days beside a 30-day total, and a partial-day rule on the browser's day
  instead of the UTC bucket day; an m365 crash while channel queries load; Home, the Warden summary and the board counting three
  different sets; the board's count and its empty sentence from two sets; loading/failed reads stated as data gaps (garmin load and
  recovery footers, body-composition rate); an ACWR described as a 7 d vs 28 d load when it is an EWMA ratio. Rejected: restoring the
  reading half-star note (the round scored it as narration — the bucket label states its range instead); keeping the weight chart's
  x-axis running to today (staleness is stated in words on the headline).
- **Round `w26-r1`** (live production, `basalt-ui shot --base https://argo.jkrumm.com`, `argo-auth` seeded from
  `secrets-run read op://common/api/SECRET` via env, 1440 + 390, both schemes; 1320 shots, 8 harness failures — tall-anchor focus
  timeouts). The m365 phone panes were shot for the first time with a `--local-storage basalt:m365-explorer=…` pane preset
  (two extra runs). Boards: `.design-shots/w26-r1-{a,b,c,m365-labeled,m365-detail}` (gitignored), copied to the MacBook,
  `~/Downloads/argo-design-review/w26/`. Scored by three fresh `basalt-design-reviewer`s (each with the w25 shots of the same routes
  to classify every defect) plus a Keel side-by-side; per-page verdicts in `docs/design/<page>.md` § "Wave 26 round".
- **Reviewer verdict, stated plainly:** **fail — all thirteen pages.** The honest trend, as the reviewers classified it (counts are
  defects, not pages): **~66 fixed** from the Wave 25 open lists; **28 carried** (named in w25, still open); **35 new** (not in the
  w25 shots — introduced by this wave); **35 unscored** (present in the w25 shots, named only now — the bar found them, the wave did
  not cause them). Calendar is the one page with no new defect. The new defects cluster in four places: (1) **the plain-question
  fallback** — with no authored question, distinct Warden items collapse to the same `Implement {repo} change?` and every agent ask
  to `Answer this request?`, so titles no longer tell items apart (home, warden, agents); (2) **cells emptied by removing a
  non-answering visual** — reading pace, the astro Cloud cell (the stretch moved from Core), walking pad's strip, the reading
  time-read card; (3) **new copy that narrates or restates again** — usage tooltips about "the dashed line", hermes `last 7 days`
  vs `This week`, `gate gate`, the strength diagnostics title, two "last session" dates on strength; (4) **390 wraps** of units and
  status words (body composition, walking pad, garmin, astro sources).
- **Against Keel:** holds up — none; close — Home, Garmin, Body composition, Calendar, Strength (up), WalkingPad, Astro (up), M365,
  Usage; does not yet — Agents, Warden, Reading, Hermes.
- **The finding that changes the plan (again, sharper):** the argo-side question rule is done and cannot get better on its own. The
  plain rung is honest but generic; Keel-grade titles need the producers' authored `question`. argo now reads it on every surface
  (`question` on warden `awaiting_owner` rows and board items, agents overview agents) — the producer change in warden and
  agent-gateway stays the owner's call. Until it lands, Wave 27's argo mitigation is a distinguishing plain rung (the item's own
  short title or alert key in the question when two cards would otherwise collide), not more derivation from prose.
- **Not verified:** focus states on 8 anchors (harness timeouts); the astro night-strip hover tint (the harness hovers the selected
  cell); the m365 detail pane at 390 with a source open (the preset opens it empty); info tooltips with no `data-shot-tooltip` anchor.
- **Basalt-owned rows:** `UPSTREAM.md` § "Wave 26" (`Lines` naming switch, `PageSummary` wrapped `·`, disclosure inset, tooltip
  over value at 390, sparkline focus start, heading slashed zero, `BandStrip`/`BarList`, two harness asks).
- **Cleanup:** worktrees removed with `rd fan --clean`; no background task left running.

## Wave 27 — Re-score round 6: distinguishing questions, cells that answer <!-- status: done -->

Same shape as Wave 26 (fan-out on disjoint page files, two independent reviews per PR, `rd merge`, live re-shoot — including the
m365 pane presets — fresh `basalt-design-reviewer`s with the previous round's shots for new/carried/unscored, + a Keel side-by-side).
Basalt-owned items wait for basalt (`UPSTREAM.md` § "Wave 23"–"Wave 26"). Each page's detail is in `docs/design/<page>.md`
§ "Wave 26 round". Gate addition: every PR's CI `check` run must be green before `rd merge` (Wave 26 merged a test that passed only
on the mini's ICU).

- [x] Questions that tell items apart: until the producers send `question`, the plain rung carries the item's own short handle
      (title lead, alert key) whenever two cards on one surface would read the same, and never frames an alert as a change; Home,
      Warden and Agents. The producer change stays queued for the owner.
- [x] Fix the argo items per page, fanned out:
  - New defects first (see each page's "New:"), then carried, then unscored.
  - Cells that went blank when a visual was dropped get a fact or a visual that answers them (reading pace, astro cloud with its
    statistic and window agreeing with Forecast, walking pad strip, reading time-read).
  - Copy that narrates or restates: usage tooltips, hermes window names, astro `gate gate`, strength diagnostics title and the two
    last-session dates, every total printed more than once (usage spend ×5, strength readiness ×3, m365 counts).
  - 390 wraps of units and status words: keep a value with its unit (non-breaking space) everywhere a unit follows a number.
- [x] Re-shoot all pages live and re-score; any page still below the bar gets a Wave 28 in this shape. The loop ends only when a
      fresh scorer and the owner find nothing worth improving.

**Left behind:**

**Closed out (orchestrated): Wave 28 is added as `active`, not spawned; the orchestrator spawns it.**

- **Wave rule: subtract before you add.** Every brief carried it; every PR body lists `## Added copy` with the fact each line gives
  and `## Removed copy`; each review was told to reject added copy that narrates, restates, renames a window or describes loading.
  Shared helper landed first on master (`e655304`): `withUnit` / `NBSP` in `lib/format.ts`.
- **Landed (master, deployed, `/api/health` = `8da6d87`, check + deploy workflows green):** five fan-out PRs, each with two
  independent agent-gateway review rounds, scope frozen after round 2, the last fix diff read by the lead, CI `check` green on the PR
  head before `rd merge` (the W26 gate addition), `make check` green after every rebase: #107 garmin + walking pad + body composition,
  #108 astro (API: additive `cloudRuinsAt`; Tonight, Forecast and the verdict card read one `lowCloudStat` — the engine's scored mean,
  floored, tick only with a shooting window; `docs/ASTRO-WINDOW.md` updated), #109 strength + reading + calendar, #110 usage + m365 +
  hermes, #111 the distinguishing question rung (`resolveCopies` in `lib/question-copy.ts`: per-surface collision check → the item's
  handle → next clause → an ordinal; one `isAlert`) + agents + warden + home.
- **Code review caught:** a Cloud tick drawn against the engine's limit on a different statistic (peak vs scored mean) — the W26 bug
  class again; a recovery cell blank on a failed read; a basalt `ScheduleRow` internals override (reverted, now an UPSTREAM row); a
  zero-move `0 of {n} lifts up` headline; `dropPartialBucket` mixing local getters with UTC; `Latest {n} messages` asserting the fetch
  cap; `No threads yet` beside an archived list; ordinals that still collided and handles cut mid-word; non-string producer fields
  that threw; `in 0 projects`. Rejected (subtraction kept): restoring the load thresholds footer, the walking pad UTC footer, the
  recovery sparkline, the gate's dash, an `includes today` tooltip clause.
- **Round `w27-r1`** (live, `basalt-ui shot --base https://argo.jkrumm.com`, `argo-auth` seeded from `secrets-run read
  op://common/api/SECRET` via env, 1440 + 390, both schemes, plus the two m365 pane presets; 1405 shots, 7 focus timeouts). Boards:
  `.design-shots/w27-r1-{a,b,c,m365-labeled,m365-detail}` (gitignored), copied to the MacBook, `~/Downloads/argo-design-review/w27/`.
  Three fresh `basalt-design-reviewer`s, each given the w26 shots to classify every defect, plus a Keel side-by-side; per-page
  verdicts in `docs/design/<page>.md` § "Wave 27 round".
- **Reviewer verdict, stated plainly:** **walking pad passes — the first page to pass the bar. Twelve fail.** Counted from the
  reviewers' lists: **53 fixed**, **32 carried**, **32 new**, **27 unscored**. Calendar and usage have no new defect. New defects
  are no longer mostly added copy — the subtraction rule held. They cluster in three places: (1) **lost facts** — copy removed where a
  reader needed it (garmin recovery reason, home next-meeting name, astro mid/high cloud, body-comp window, reading `★`, strength
  headline when nothing moved, agents needs-you footer); (2) **cells that stretch again** once a footer went (home meeting, agents
  needs-you, garmin recovery, warden unattended) — removing a line from one cell re-exposes `StatGroup`'s row stretch; (3) **the
  question rung** — `[alert]`-prefixed Warden titles are still framed as changes (the alert check reads a `Alert:` prefix, the
  producer writes `[alert] …`), handles cut at an open bracket, a `Handle … alert?` question over an `Implement` button, agents
  titles that restate their evidence line.
- **Against Keel:** close — Home, Garmin, Body composition, Calendar, Strength, WalkingPad, Astro, M365, Usage; does not yet —
  Agents, Warden, Reading, Hermes.
- **Not verified:** focus on garmin fitness, strength bench press and two m365 anchors (timeouts); astro night-strip hover; the m365
  390 detail pane with a source open.
- **Basalt-owned rows:** `UPSTREAM.md` § "Wave 27" (`SelectFilter` option slot, `ScheduleRow` wrap, `Sparkline` reference label,
  `DualPanel` ticks, mono ligatures, sticky bars over crops). basalt-ui 2.21.0 had not shipped; argo stays on 2.20.0.
- **Producer change still queued for the owner:** an authored `question` from warden and agent-gateway; argo reads it on every
  surface already.
- **Cleanup:** worktrees removed with `rd fan --clean`; no background task left running.


## Wave 28 — Re-score round 7: lost facts, alert titles, one stretch rule <!-- status: done -->

Same shape as Wave 27 (fan-out on disjoint page files, two independent reviews per PR, CI `check` green on the PR head before
`rd merge`, live re-shoot incl. the m365 pane presets, fresh `basalt-design-reviewer`s with the w27 shots + a Keel side-by-side). The
rule stays **subtract before you add**, with its counterpart made explicit: a removal that leaves a reader without a fact is a defect
(every `## Removed copy` line names where that fact still lives, or why no reader needs it). Each page's detail is in
`docs/design/<page>.md` § "Wave 27 round". WalkingPad passed: only its two unscored polish items, no redesign.

- [x] Alert titles and handles: recognise the producer's `[alert]` prefix (and the board item's own origin/kind), never cut a
      handle inside a bracket or mid-token, the question's verb matches the primary button, agents titles never restate their evidence
      line. Home, Warden and Agents. The producer change stays queued for the owner.
- [x] Fix the argo items per page, fanned out: new first ("lost facts" restored in the shortest form that carries them, the
      re-stretched cells fixed by shortening the tallest neighbour rather than re-adding a footer), then carried, then unscored.
- [x] Re-shoot all pages live and re-score; any page still below the bar gets a Wave 29 in this shape. The loop ends only when a
      fresh scorer and the owner find nothing worth improving.

**Left behind:**

**Closed out (orchestrated): Wave 29 is added as `active`, not spawned; the orchestrator spawns it.**

- **basalt-ui 2.21.0** landed in its own commit (`7390e3c`: `bun install`, `basalt-ui sync`, MIGRATING § 2.21.0 read; no `BarList
  variant="default"` in argo). No local strip-cell stretch workaround existed to drop — swept the whole dashboard, none found; the
  workers were told not to add one and the stretched-cell items went out as `waits: basalt 2.21.0`.
- **Landed (master, deployed, `/api/health` = `b93552d`, check + deploy workflows green):** five fan-out PRs, each with two independent
  agent-gateway review rounds, scope frozen after round 2, the last fix diff read by the lead, CI `check` green on the PR head before
  `rd merge`, `make check` green after every rebase: #112 astro, #113 garmin + body composition + walking pad, #114 strength + reading,
  #115 usage + m365 + hermes, #116 the question rung (`[alert]` prefix, structured handles `{stem, lead, ordinal}`, verb from the primary
  action, terse stems re-checked for collisions) + home + warden + agents, and one duration helper (`formatDuration` / `formatAgo` in
  `lib/format.ts`) across home, agents, warden, calendar and `ScheduleRow`.
- **Code review caught:** the moon detail parsed API prose (now structured fields, the reason verbatim otherwise); a low-cloud limiting
  factor two predicates could drop; `Gate clearance` measuring against the skyline; a speculative `fills on sync`; a `NaN bpm` focus
  readout; missing recovery inputs attributed to the last scored day; a bare `±{x}` zone caption; a headline denominator counting
  unscored lifts and `0 of 0`; balance direction; the untitled count printed twice; an m365 headline asserting the fetch cap; terse
  stems that re-collided; a page-blanking `!` on a missing ask; a hover-only fact; `0 min`; Merge on a failed verification.
- **Round `w28-r1`** (live, `basalt-ui shot --base https://argo.jkrumm.com`, `argo-auth` seeded from `secrets-run read
  op://common/api/SECRET` via env, 1440 + 390, both schemes, plus the two m365 pane presets; 1549 shots, 12 focus timeouts; the light
  desktop page timed out in both presets, covered by the main run). Boards: `.design-shots/w28-r1-{a,b,c,m365-labeled,m365-detail}`
  (gitignored), copied to the MacBook, `~/Downloads/argo-design-review/w28/`. Three fresh `basalt-design-reviewer`s, each given the w27
  shots to classify every defect, plus a Keel side-by-side; per-page verdicts in `docs/design/<page>.md` § "Wave 28 round".
- **Reviewer verdict, stated plainly:** **walking pad passes again; twelve fail.** Counted from the reviewers' lists: **≈47 fixed**,
  **≈37 carried**, **19 new**, **≈36 unscored** (the reviewers read further into crops this round). Calendar, reading and hermes have
  no new defect. The new defects cluster in three places: (1) **the question rung over-corrected** — when no handle fits whole, change
  titles fall to `Implement {repo} change ({n})?` and lose their subject (Home, Warden), and Agents card 3 is back to the generic
  `Answer this request?`; (2) **over-glued text** — `Latest changes` ages glued end to end now break mid-word in the decision-card
  panel, and `mid` / `{m} %` split at 1440; (3) **lost facts again** — the body-comp maintenance band width, the 2.21.0 meters hiding a
  zone name (caution, maintain), astro cloud-layers printing the mid value three times instead of once.
- **Stretch on 2.21.0:** align-by-part fixed most strips (warden, reading shelf, the c pages are all under 0.4), but five short cells still
  read 0.47–0.62 empty beside a tall sibling — an UPSTREAM row, not an argo workaround.
- **Against Keel:** close — Garmin, Body composition, Calendar, Strength, WalkingPad, Astro, Usage; does not yet — Home (regressed:
  ordinal titles), Agents, Warden, Reading, Hermes, M365.
- **Not verified:** focus on garmin fitness, strength bench press, one warden board card (left the board mid-run) and one m365 anchor;
  the m365 390 labeled header and the 390 detail pane with a source open; strength full-page shots below the first viewport.
- **Basalt-owned rows:** `UPSTREAM.md` § "Wave 28" (strip short-cell void on 2.21.0, hidden zone names, detached ticks, the
  `series-palette` guard skipping `p(BP.*)` entries, `BandStrip` ticks/hue/tooltip, chip and row hover, the 10.67 px select inset,
  `ViewTabs` 390 alignment, narrow chart tooltips).
- **Producer change still queued for the owner:** an authored `question` from warden and agent-gateway — the ordinal regression shows
  how far a derived question can go.
- **Cleanup:** worktrees and tabs removed with `rd fan --clean`; no background task left running.

## Wave 29 — Re-score round 8: subjects back in titles, glue that wraps, one figure each <!-- status: done -->

Same shape as Wave 28 (fan-out on disjoint page files, two independent reviews per PR, CI `check` green on the PR head before
`rd merge`, live re-shoot incl. the m365 pane presets, fresh `basalt-design-reviewer`s with the w28 shots + a Keel side-by-side). The
rule stays **subtract before you add**, and a removal that leaves a reader without a fact is a defect. Each page's detail is in
`docs/design/<page>.md` § "Wave 28 round". WalkingPad passed twice: leave it. Stretched short cells are basalt's (`UPSTREAM.md`
§ "Wave 28"): no local workaround.

- [x] The question rung: a title never drops its subject for an ordinal — when the whole handle does not fit, cut the handle at a word
      (no ellipsis before `?`) and keep the ordinal only as a last tie-break; Agents never falls back to `Answer this request?`; titles
      never restate their evidence line; Home's verb matches its only button (`Open in Warden`). Home, Warden and Agents.
- [x] Fix the argo items per page, fanned out: new first (glue that wraps at phrase boundaries rather than mid-word; the maintenance
      band width back once; a `short` for every zone the 2.21.0 Meter hides; astro's mid value once), then carried, then unscored.
- [x] Re-shoot all pages live and re-score; any page still below the bar gets a Wave 30 in this shape. The loop ends only when a
      fresh scorer and the owner find nothing worth improving.

**Left behind:**

**Closed out (orchestrated): Wave 30 is added as `active`, not spawned; the orchestrator spawns it.**

- **basalt-ui stayed on 2.21.0** — no release was announced during the wave, so no bump commit.
- **Landed (master, deployed, `/api/health` = `9437bcc`, check + deploy workflows green):** five fan-out PRs, each with two independent
  agent-gateway review rounds, scope frozen after round 2, the last fix diff read by the lead, CI `check` green on the PR head before
  `rd merge`, `make check` green after every rebase and again on the merged master: #117 garmin + body composition, #118 strength + reading,
  #119 usage + m365 + hermes, #120 astro, #121 the question rung + home + warden + agents. WalkingPad untouched.
- **The question rung is one deterministic, table-tested function** (`questionTitles` / `surfaceCopies` in `lib/question-copy.ts`): the verb
  from the primary button (Home `Decide on {kind}: {subject}?` over its only `Open in Warden`), the subject kept and cut at a word with no
  ellipsis before `?`, conventional-commit `type(scope):` stripped, siblings told apart by more of their subject, an ordinal only for
  word-identical normalised subjects (code-unit order), no generic `Answer this request?` when an ask exists, the evidence line never
  restating the title. The table is `apps/dashboard/src/lib/__fixtures__/question-rung.ts`: every live title pattern from the production
  warden snapshot and agents overview of 2026-10-18, anonymised (same length, shape and punctuation; the lead grepped the diff against the
  live identifiers — zero hits), with the expected title per row, plus the three regressions as named cases. A fix that moves any row fails a test.
- **Code review caught:** ordinals decided on truncated text (twice — a word-prefix pair still got `(1)`/`(2)`); a shortcode-wrapped
  verification failure still offering `Merge`; an unterminated evidence remainder dropped; real identifiers left in the first fixture;
  a commit-prefix strip that would eat `warning:`; the maintenance band width printed twice, then again in the in-band footer; a `0.0 t`
  week; a lost diagnostics period; a cross-year m365 span without years; hermes losing its only created-at fact; a dead kind-bar caption;
  the astro moon gate falling back to API prose; a selected best night losing its window; a flat cloud layer losing its value; a score card
  that could hide an unknown killer.
- **Gate flake:** `apps/api/src/lib/hermes-streams.test.ts` (and two astro visibility tests) time out under load — the mini ran at a load
  average of ~62 with other waves; each passes 3/3 in isolation and every merge went green on a retry. Not an argo regression; worth a
  longer per-test timeout if it recurs.
- **Round `w29-r1`** (live, `basalt-ui shot --base https://argo.jkrumm.com`, `argo-auth` seeded from `secrets-run read
  op://common/api/SECRET` via env, 1440 + 390, both schemes, plus the two m365 pane presets; 1426 shots, 10 focus timeouts). Groups b/c and
  the presets were shot once their PRs were live, group a after #121 deployed. Boards: `.design-shots/w29-r1-{a,b,c,m365-labeled,m365-detail}`
  (gitignored), copied to the MacBook, `~/Downloads/argo-design-review/w29/`. Three fresh `basalt-design-reviewer`s, each given the w28 shots
  to classify every defect, plus a Keel side-by-side; per-page verdicts in `docs/design/<page>.md` § "Wave 29 round".
- **Reviewer verdict, stated plainly:** **walking pad passes a third time; twelve fail.** Counted from the reviewers' lists: **≈41 fixed**,
  **≈35 carried** (most of them basalt rows), **17 new**, **≈15 unscored**. **No regression and no lost fact on any page** — the first
  round with neither. Body composition, reading and calendar have no new defect; body composition's remaining items are all basalt's.
- **What the new defects say:** (1) **the question rung is now stable but has hit its ceiling** — titles keep their subjects, never number
  distinct items and match their buttons, yet the reviewer reads `{stem}: {raw subject}?` as an instruction with a `?`, not a question
  (Home, Warden, Agents). A derived title cannot become an authored question; the producer `question` field from warden and agent-gateway
  (queued for the owner since Wave 26) is the fix, not another rung change. (2) **compound durations** — gluing only number↔unit lets a
  two-part age break between its parts (`{h} h` / `{m} min ago`); a duration's own parts must stay together while `ago` stays breakable.
  (3) **small consistency slips** — warden's headline wait in decimal days, a raw backtick and `[monitor]` prefix in titles, Garmin's ACWR
  legend missing caution, strength's ACWR tooltip in kg beside a chart in t, the m365 remove control now visible at rest (against the
  Wave 22 ruling), astro's Sky footer stretching the anatomy row.
- **Against Keel:** close — Garmin, Body composition, Calendar, Strength, WalkingPad, Astro, Usage, M365 (up from does not yet), Home and
  Warden (both up); does not yet — Agents, Reading, Hermes.
- **Not verified:** garmin fitness, strength bench press, m365 source-list and labeled-phone focus (timeouts); the 390 m365 detail pane with a
  source open; warden board focus; Garmin's recovery meter (no score on the shot day); the astro night-strip hover (the harness hovers the
  selected cell).
- **Basalt-owned rows:** `UPSTREAM.md` § "Wave 29" (an optional `Meter` zone label, one zone-name rule across widths, a `Lines` end-label
  switch, a `Bars` non-hue cue, the `0` tick under the first bar, `SegmentBar` row captions) plus the re-confirmed Wave 28 rows.
- **Producer change still queued for the owner:** an authored `question` from warden and agent-gateway — Wave 29 shows the derived rung is
  as good as derivation gets.
- **Cleanup:** worktrees and tabs removed with `rd fan --clean`; no background task left running; the live data used for the fixture was
  kept outside the repo (`/tmp`) and never committed.

## Wave 30 — Re-score round 9: compound durations, one vocabulary per surface, the rung frozen <!-- status: done -->

Same shape as Wave 29 (fan-out on disjoint page files, two independent reviews per PR, CI `check` green on the PR head before
`rd merge`, live re-shoot incl. the m365 pane presets, fresh `basalt-design-reviewer`s with the w29 shots + a Keel side-by-side). The
rule stays **subtract before you add**, and a removal that leaves a reader without a fact is a defect. Each page's detail is in
`docs/design/<page>.md` § "Wave 29 round". WalkingPad passed three times: leave it. Basalt rows (`UPSTREAM.md` § "Wave 28" and § "Wave 29"):
no local workaround. **The question rung is frozen:** its table (`lib/__fixtures__/question-rung.ts`) is the contract; a title change
needs a new table row first, and the authored producer `question` stays the owner's call.

- [x] Compound durations and leftover title noise (Home, Warden, Agents): a duration's own parts stay together (`{h} h {m} min` never splits,
      `ago` stays breakable); warden's headline wait in the cards' spelling; raw backticks and the monitor's `[…]` prefix out of titles (new
      table rows); the Agents headline carries the needs-you count or the oldest wait; `Answer:` vs a `Copy …` primary; the CI-failed card's
      `Merge` secondary; the failed card's garbled `— PR left open` evidence.
- [x] Fix the argo items per page, fanned out: new first (Garmin ACWR legend names caution; strength ACWR tooltip in t; m365 remove control
      back to hover/focus with the muted token; astro Sky footer that stretches the anatomy row and the run-together cloud headline; usage
      `days` orphan; hermes fold label; m365 390 date/year split), then carried, then unscored.
- [x] Re-shoot all pages live and re-score; any page still below the bar gets a Wave 31 in this shape. The loop ends only when a
      fresh scorer and the owner find nothing worth improving.

**Left behind:**

**Closed out (orchestrated): Wave 31 is added as `active`, not spawned; the orchestrator spawns it.**

- **basalt-ui stayed on 2.21.0** — no release was announced during the wave, so no bump commit.
- **Landed (master, deployed, `/api/health` = `04aa13d`, check + deploy workflows green):** seven fan-out PRs, each with two independent
  agent-gateway review rounds, scope frozen after round 2, the last fix diff read by the lead, CI `check` green on the PR head before
  `rd merge`, `make check` green after every rebase and again on the merged master (1408 + 598 pass, build green, zero new `basalt/*`
  suppressions). Round 9: #122 garmin + strength + reading, #123 astro, #124 usage + m365 + hermes, #125 home + warden + agents + the shared
  duration glue. Follow-ups from the live re-score, same wave: #126 + #127 (r1 regressions), #128 (r2 regressions). WalkingPad untouched.
- **The rung stayed frozen:** every moved fixture row in #125 is named by a Wave 30 item (backticks and the monitor bracket out, one retry
  shape, the copy-button verb on Agents, an alert keeping its kind) and its newly visible words are the subject's own text; four new rows
  (no doubled `failed`, `Alert: [..] Down`, `[alert] [..] Down`, the alert-kind ask). No authored-question path was added.
- **What the lead caught before review:** a legend swatch with no matching fill (Garmin ACWR caution); a dropped `formatX` that would have
  put a clock time in the strength tooltip; touch users losing the m365 remove control; a fixed-unit token formatter printing non-zero as
  `0.0 M`; the dark-sky threshold leaving Tonight with no label; `at its lowest` (factually wrong — the figure is nearest the gate); two
  names for one zone on one page; an unrequested meter tint swap.
- **Code review caught:** `Merge` kept on a provider-prefixed CI failure; a non-string wire reason that would throw in render; a dash
  question folded into a statement; an Agents alert losing its kind; the monitor prefix surviving after `Alert:`; the "oldest wait" headline
  showing a younger agent wait over an older ask; hybrid-pointer devices hiding the m365 control; `999.96` printing unitless `1000`; a
  title-card total and its rows in two units; the threshold losing its unit; a ruled-out night with a moon factor dropping its cloud row;
  the reading 390 label collision coming back; an echo-tail rule that would drop a real current state; the NBSP glue breaking the
  evidence/disclosure comparison.
- **Rounds:** `w30-r1` (all pages live, 1440 + 390, both schemes, plus the two m365 pane presets; 1426 shots, 10 focus timeouts); `w30-r2`
  (home, garmin, warden, astro, reading, strength after #126/#127); `w30-r3` (warden, astro, reading after #128). `basalt-ui shot --base
  https://argo.jkrumm.com`, `argo-auth` seeded from `secrets-run read op://common/api/SECRET` via env, never printed or written. Boards:
  `.design-shots/w30-r{1,2,3}-*` (gitignored), copied to the MacBook, `~/Downloads/argo-design-review/w30/`. Fresh
  `basalt-design-reviewer`s each given the previous round's shots, plus a Keel side-by-side; verdicts in `docs/design/<page>.md`
  § "Wave 30 round"; basalt rows in `UPSTREAM.md` § "Wave 30".
- **Reviewer verdict, stated plainly:** **walking pad passes a fourth time; twelve fail.** Two regressions came from this wave's own r1
  changes (the strength band range hidden at 390, the clipped astro Sky footer) and one from the vocabulary change (`Undertrained` colliding
  at 390); all three are fixed and verified live. No lost fact remains except the bare tick label below. Usage, M365, Hermes, Calendar and
  Body composition have no open argo-owned defect — what fails them is basalt rows and harness gaps.
- **Against Keel:** close — Home, Agents (up from does not yet), Garmin, Warden, Strength, Calendar, Body composition, WalkingPad, Astro,
  Usage, M365; does not yet — Reading, Hermes.
- **Harness finding:** `/api/health` proves only the API image; the dashboard image rolls later, so the first shot pass after a deploy
  (light 1440 in r1 and r3) can render the previous bundle. Wave 31 waits for the dashboard bundle itself before shooting.
- **Gate flake:** the `hermes-streams` timeout test prints `ack timeout` as expected output; no flake this wave.
- **Not verified:** the m365 hover reveal (the harness hovers the pane, not a row); reading `last read` at 390 (no anchor on that row);
  the light 1440 pass of r3; garmin fitness and strength bench-press focus (timeouts).
- **Cleanup:** worktrees and tabs removed with `rd fan --clean`; no background task left running.

## Wave 31 — Re-score round 10: thresholds that name themselves, the last orphans <!-- status: done -->

Same shape as Wave 30 (fan-out on disjoint page files, two independent reviews per PR, CI `check` green on the PR head before
`rd merge`, live re-shoot incl. the m365 pane presets, fresh `basalt-design-reviewer`s with the w30 shots + a Keel side-by-side). The
rule stays **subtract before you add**, and a removal that leaves a reader without a fact is a defect. Each page's detail is in
`docs/design/<page>.md` § "Wave 30 round". WalkingPad passed four times: leave it. Basalt rows (`UPSTREAM.md` § "Wave 28"–"Wave 30"):
no local workaround. The question rung stays frozen to its table; the authored producer `question` stays the owner's call. **Shoot only
once the dashboard bundle is live** (the served `index.html` references the new asset hash), not on `/api/health` alone.

- [x] basalt-ui 2.22.0 in its own commit, MIGRATING read, the props that close UPSTREAM rows adopted and their local workarounds deleted, the closed rows marked in `UPSTREAM.md`.
- [x] Fix the open argo items, fanned out: astro's Sky tick label names itself (`dark ≥ {t}` or equivalent, the unit reachable) and the
      Sky footer fits two lines at 1440; a warden title that breaks mid-identifier; a failed card's `Full reason` that only repeats a whole
      evidence line; Home's recovery tile and Garmin's recovery cell stating different facts for the same day; usage's cost readout in
      cents and `{m}%` vs `{m} %`; hermes' untitled count said twice. Then carried, then unscored.
- [x] Re-shoot all pages live and re-score; any page still below the bar gets a Wave 32 in this shape. The loop ends only when a
      fresh scorer and the owner find nothing worth improving.

**Left behind:**

**Closed out (orchestrated): Wave 32 is added as `active`, not spawned; the orchestrator spawns it.**

- **basalt-ui 2.22.0** in its own commit (`90c2844`): `basalt-ui sync` refreshed the managed files; the release's
  `basalt/shadow-basalt-export` rule rejected argo's local `PageSummary`, so the 13 page imports moved to the export and
  `components/upstream/page-summary.*` was deleted in that commit (WalkingPad's only change this wave). No further release was
  announced during the wave.
- **Landed (master, deployed, `/api/health` = `fc7facf`, check + deploy workflows green):** five fan-out PRs, each with two independent
  agent-gateway review rounds, scope frozen after round 2, the last fix diff read by the lead, CI `check` green on the PR head before
  `rd merge`: #129 astro, #130 strength + reading + body composition + calendar, #131 home + garmin, #132 usage + m365 + hermes, #133
  warden + agents. Follow-ups from the live re-score, same wave, one review round each (no blocking finding; both restore pre-wave
  code): `a4dd5ab` (the body-composition tooltip date) and `fc7facf` (the strength balance fill). `make check` green on the merged
  master (1432 + 598 pass, build green), zero new `basalt/*` suppressions. WalkingPad untouched beyond the forced import.
- **Adopted from 2.22, subtracted locally:** `PageSummary`; `size="row"` part captions (the m365 footer legend deleted); the row
  surfaces (m365 rows, astro night strip); the single-series legend default (`legend={false}` dropped on three charts); `hideValue`
  (garmin VO2max); `referenceLabel` (strength PR line). Reverted after the live shot: the tooltip-header default (lost the weekday
  and year) and `MeterZone tone: 'muted'` (the over-band read as a value bar) — both are new basalt rows. `UPSTREAM.md`: closed rows
  marked inline, the rest in § "Wave 31".
- **The rung stayed frozen:** no title text changed. Warden/Agents identifiers stay whole through `nowrap` spans at render time
  (the copy model, the rung fixture and the aria-label stay raw). No authored-question path was added.
- **What the lead caught before review:** a one-item `period` list that ran unit and period together again; `interferes` claimed for
  any moon above the horizon (the gate's illumination limit decides); a past-day reading losing the 7 d mean; the warden worker editing
  `lib/format.ts` outside its file list (accepted, no other worker owned it).
- **Code review caught:** word joiners in the warden title leaking into copied text and find-in-page; a short `Full reason` swallowed
  by a substring inside an unrelated word; a non-idempotent glue pattern; a verdict classified on the unrounded score (`69.9` showing
  `70` as Normal); the usage band fills switched to the pale status inks; a fold label split between model and view.
- **Rounds:** `w31-r1` (all pages live, 1440 + 390, both schemes, plus the two m365 pane presets; shot after the served bundle carried
  the new chunks, not on `/api/health` alone), `w31-r2` (body composition + strength after the follow-ups). `basalt-ui shot --base
  https://argo.jkrumm.com`, `argo-auth` seeded from `secrets-run read op://common/api/SECRET` via env, never printed or written. Boards:
  `.design-shots/w31-r{1,2}-*` (gitignored). Fresh `basalt-design-reviewer`s each given the w30 shots, plus a Keel side-by-side;
  verdicts in `docs/design/<page>.md` § "Wave 31 round"; basalt rows in `UPSTREAM.md` § "Wave 31".
- **Reviewer verdict, stated plainly:** **Reading passes for the first time, WalkingPad a fifth time.** Agents and Warden pass every
  component and fail only on `craft-7/no-declared-states` (below). Home, Garmin, Body composition, Calendar, Strength, Astro, Hermes,
  M365 and Usage fail. No lost fact remains (the one this wave caused, the tooltip date, is fixed and verified in r2).
- **Against Keel:** close — Home, Agents, Garmin, Warden, Strength, Calendar, Body composition, WalkingPad, Astro, Usage, M365; does
  not yet — Reading, Hermes.
- **Harness finding:** basalt-ui 2.22's `shot` renders empty/loading/error only for anchors that declare `data-shot-states`; argo
  declares none, so those states went unrendered and `shot detect` reports P1 on every page. Wave 32 declares them.
- **Boards copied to the MacBook:** `~/Downloads/argo-design-review/w31/` (`w31-r1-*`, `w31-r2-b`); `iumac` was offline on the tailnet
  for most of the close-out and came back before the commit.
- **Gate flake:** the merge train's first `make check` on `w31/usage-m365-hermes` failed two `hermes-streams` resume tests under load
  (22.8 s run); 598/598 on the immediate rerun, no API code touched.
- **Not verified:** the m365 labeled-row hover (the harness hovers the pane); the astro night-strip row hover (it hovers the selected
  cell); whether the one warden card still offering `Full reason` adds text.
- **Cleanup:** worktrees and tabs removed with `rd fan --clean`; no background task left running.

## Wave 32 — Re-score round 11: declared shot states, the small orphans, one wording per gap <!-- status: done -->

Same shape as Wave 31 (fan-out on disjoint page files, two independent reviews per PR, CI `check` green on the PR head before
`rd merge`, live re-shoot incl. the m365 pane presets once the dashboard bundle is live, fresh `basalt-design-reviewer`s with the w31
shots + a Keel side-by-side). **Subtract before you add**; a removal that leaves a reader without a fact is a defect. Each page's detail
is in `docs/design/<page>.md` § "Wave 31 round". Reading and WalkingPad pass: leave them. Basalt rows (`UPSTREAM.md` § "Wave 28"–"Wave 31"):
no local workaround. The question rung stays frozen to its table; the authored producer `question` is an owner-approved backlog item in
warden and agent-gateway, not built — add nothing for it.

- [x] Declare `data-shot-states` (`empty loading error`) on each page's anchors that have those states, so basalt-ui 2.22's shot renders
      and scores them again (every page; Agents and Warden fail on nothing else).
- [x] Fix the open argo items, fanned out: Home's show-more Warden count vs the facts line, the feed's raw `[{monitor} - …]` title
      prefix, the recovery footer's orphaned figure, one wording for the pre-sync recovery gap on Home and Garmin; Garmin's recovery
      chart facts separator; astro's Sky tick at one of the cell's three sizes with its unit reachable on screen, and the Sky footer in
      two lines at 1440; the argo-local `ScheduleRow`'s cancelled-row duration overlap and its sizes; m365's kind caption restating the
      hero and the empty 1440 page height; usage's mixed-precision token rows. Then carried, then unscored.
- [x] Re-shoot all pages live and re-score; any page still below the bar gets a Wave 33 in this shape. The loop ends only when a
      fresh scorer and the owner find nothing worth improving.

**Left behind:**

**Closed out (orchestrated): Wave 33 is added as `active`, not spawned; the orchestrator spawns it.**

- **The shot-state seam (lead, on master before the fan-out):** `apps/dashboard/src/lib/shot-state.ts` reads `?shot-state=` once at
  load; `lib/eden.ts`'s `fetcher` never settles under `loading` and answers 503 under `error`, `lib/router.ts` skips the retry under
  `error`; `empty` is page-owned (`shotState() === 'empty'` substitutes the query's empty value at the read). Honoured in the production
  bundle on purpose (the loop shoots the deployed dashboard; the param writes nothing). Commits `b335923`, `5d97986` (test windows
  without `location`), `f023a73`, `0abf76c`. A `shotLoader` (skip awaited loaders under loading/error) was added and **dropped the same
  hour**: it rendered card states production never reaches. The rule that replaced it: a state is declared only where production renders
  it — a route whose loader awaits its data shows the route pending screen / `CrashFallback`, so its anchors declare `empty` only.
  basalt's `shot` reads the declared set from the REST render, so the declaration sits on a rest anchor (it may also carry
  `data-shot-absent`), the empty UI gets its own anchor, and every rest anchor gone under a state carries `data-shot-absent`.
- **Landed (master, deployed, `/api/health` = `732a53f`, Deploy + check workflows green):** five fan-out PRs, each with two independent
  agent-gateway review rounds, scope frozen after round 2, the last fix diff read by the lead, CI `check` green on the PR head before
  `rd merge` (the first train run stopped on draft PRs; marked ready, re-run): #134 warden + agents, #135 strength + body composition +
  reading + walking pad, #136 astro, #137 usage + m365 + hermes, #138 home + garmin + calendar. Follow-up after the shot, one review
  round: `69568a6` (the m365 phone panes declare `empty`). `make check` green on merged master (1441 + 598 pass, build green). Reading and
  WalkingPad changed only by state attributes and the one-line empty substitution.
- **Declared:** `empty` on every page; Calendar also `loading` / `error` (its loader only prefetches). Astro's Tonight declares nothing
  (disputed, below).
- **Fixed this round (verified live):** Home show-more as the remainder (`{m} more in Warden` / `{m} more on Agents`, label covers agent
  and human-queue items); feed Warden titles without the `[{monitor} - …]` prefix; Garmin chart facts `mean · `; the cancelled
  `ScheduleRow` duration in its column; m365 `Chats by kind` lead caption; the m365 scrollbar under the pane header; usage token precision;
  the Sky tick with its unit on screen; astro `night-anatomy` / `strip-sky` at three sizes; `craft-7/no-declared-states` everywhere but
  Tonight.
- **Not fixed (carried to Wave 33, argo):** the Home recovery footer still orphans `of {n}`; `ScheduleRow` still four type sizes; the Sky
  footer still three lines at 1440. The pre-sync recovery wording is shared in code but unverifiable live (the day was scored).
- **What the lead caught before review:** the show-more row wording the totals and the remainder identically; declarations on
  empty-only elements (invisible at rest, so craft-7 stayed); `loading` / `error` declared on loader-gated pages; whole-page wrapper
  anchors; a shot-only page-level astro card.
- **Code review caught:** the Garmin load + fitness cells unemptied under `empty`; calendar / Home sources still `unknown` under `empty`;
  a `?? ''` footer opening on ` · `; `restBy('/agents')` counting human-queue items; the m365 `LabeledPane` fragment root; the m365
  source list's false `with this label` under `empty`; the Sky footer able to open a line on `·`; a `0.95` → `0.9` float tie; absent marks
  that did not match what unmounts.
- **Rounds:** `w32-r1` (all pages live, 1440 + 390, both schemes, plus the two m365 pane presets; shot after the served bundle carried the
  new route chunks — `data-shot-states` present in them — not on `/api/health` alone). `basalt-ui shot --base https://argo.jkrumm.com`,
  `argo-auth` seeded from `secrets-run read op://common/api/SECRET` via env, never printed or written. Boards:
  `.design-shots/w32-r1-{a,b,c,m365-labeled,m365-detail}` (gitignored). Four fresh `basalt-design-reviewer`s each given the w31 shots, plus
  a Keel side-by-side; verdicts in `docs/design/<page>.md` § "Wave 32 round"; basalt rows in `UPSTREAM.md` § "Wave 32".
- **Reviewer verdict, stated plainly:** **WalkingPad passes a sixth time.** Every other page fails, and most new failures exist only
  because the states render for the first time: empty / loading / error copy that names no cause or next step, false zeros, loading
  worded as error, strips that keep live figures beside emptied charts. Reading fails on basalt-only P0s (strip-cell anchors cannot
  declare `data-shot-absent`), Strength on the same plus carried basalt rows. Agents and Warden pass every rest component. No lost fact.
- **Against Keel:** close — Home, Agents, Garmin, Warden, Strength, Calendar (at rest), Body composition, WalkingPad, Astro, Usage, M365;
  does not yet — Reading, Hermes.
- **Not verified:** the m365 labeled-pane remove error (no error rendered); the 390 m365 detail pane with a source open; row hovers the
  harness cannot reach (m365 rows, astro night strip).
- **Boards copied to the MacBook:** `~/Downloads/argo-design-review/w32/` (`w32-r1-*`).
- **Cleanup:** worktrees and tabs removed with `rd fan --clean`; no background task left running.

## Wave 33 — Re-score round 12: states that say why, strips that empty with their charts <!-- status: done -->

Same shape as Wave 32 (fan-out on disjoint page files, two independent reviews per PR, CI `check` green on the PR head before
`rd merge`, live re-shoot incl. the m365 pane presets once the dashboard bundle is live, fresh `basalt-design-reviewer`s with the w32
shots + a Keel side-by-side). **Subtract before you add**; a removal that leaves a reader without a fact is a defect. Each page's detail
is in `docs/design/<page>.md` § "Wave 32 round". WalkingPad passes: leave it; Reading changes only if a declared state needs it. Basalt rows
(`UPSTREAM.md` § "Wave 28"–"Wave 32"): no local workaround. The question rung stays frozen to its table; the authored producer `question`
is an owner-approved backlog item in warden and agent-gateway, not built — add nothing for it. A state is declared only where production
renders it (`lib/shot-state.ts`).

- [x] Every declared state says what is missing, why and what to do, in one wording per gap: the Agents / Warden `No snapshot yet` alerts
      (a next step), Warden's `no data: …` strip cells, the Agents activity strip's two-line empty, Garmin's chart empties and the
      triple-stated load cell, Usage's `No data in this window` lists and the ChartCard `empty` labels argo does not pass, m365's
      `No chats yet` and the labeled cell's blank track, astro's `Unknown site` (copy and its 49 % empty height), Hermes' `All 0` toolbar;
      Calendar's loading worded as error, `tasks-due`'s false zero under loading / error, the bare `{day} —` rows and the lone `—` in Today.
- [x] A page's strip and summary empty with its charts under `empty` (Body composition weight + rate cells, Usage's strip, Home's agents
      cell); Home and Garmin say the empty recovery window in one wording. Then the carried argo items: the Home recovery footer's
      orphaned `of {n}`, `ScheduleRow` at three sizes, the Sky footer in two lines at 1440, Tonight's declared state (settle the dispute:
      declare a real one or record why none exists), the m365 `Labeled {n}` restatement and `no channels`, the warden fixes-cell
      equation wrap. Then unscored.
- [x] Re-shoot all pages live and re-score; any page still below the bar gets a Wave 34 in this shape. The loop ends only when a
      fresh scorer and the owner find nothing worth improving.

**Left behind:**

**Closed out (orchestrated): Wave 34 is added as `active`, not spawned; the orchestrator spawns it.**

- **Landed (master, deployed, `/api/health` = `fd5acb3`, Deploy + check workflows green):** five fan-out PRs, each with two independent
  agent-gateway review rounds, scope frozen after round 2, the last fix diff read by the lead, CI `check` green on the PR head before
  `rd merge`: #139 body composition (strength unchanged), #140 warden + agents, #141 astro, #142 usage + m365 + hermes, #143 home +
  garmin + calendar. `make check` green on merged master (1462 + 598 pass) and the dashboard build green. Reading and WalkingPad untouched.
- **Fixed this round (verified live):** the Agents / Warden `No snapshot yet` alerts name the producer, cadence and what to check; Warden
  renders no strip, queues or board without a snapshot (no `no data: …` cells, no false `Nothing needs you`); the Agents activity strip
  states its absence once, needs-you / oldest-wait say `Waiting for the first snapshot`; Garmin's seven chart empties share one wording
  with the window length and sync cadence (the copy's day count now matches the preset, it read one day long), the load cell says its
  absence once; Home's recovery and agents cells word their gaps as Garmin and Agents do; Calendar `tasks-due` tracks its fetch (no false
  `0`), loading and error are worded apart, `Today` names its failed sources; `ScheduleRow` consumers at three sizes; Body composition's
  strip empties with its series; Usage's lists, charts (ChartCard `empty` labels now passed) and health share one filter-aware wording
  and its strip empties with the charts; m365's empty lists say why and what to do, the labeled cell says its absence once, no restated
  `Labeled {n}` or `no channels`; Hermes drops the `All 0` chip and search with no threads, 390 titles wrap; astro's unknown-site card
  says why and what to do and ends at its content; the warden fixes legend wraps before an operator.
- **Tonight's state, settled:** it declares none — its loader awaits the window and the site list, the API never yields an empty card,
  an empty site list only empties the selector (recorded in `astro-window.md`). The reviewer accepts the reasoning; the remaining
  `craft-7` is a rubric gap, filed as a basalt row.
- **Sky footer:** stays three lines at 1440 by decision — the page's word `transparency` and the direction hint `(1 = best)` have no
  honest two-line form (a worker's `clarity` rename inverted the scale's reading and split the vocabulary with the score card; reverted).
- **What the lead caught before review:** one empty sentence four times on one screen (body composition); a false `nothing waiting`
  under no snapshot (agents); the `clarity` rename; formatter churn in unowned docs (`UPSTREAM.md`, `warden.md`, `home.md` tables).
- **Code review caught:** shot-only masks on calendar's failure flags (removed: under `empty` only the data is substituted); a pending
  task read classified as error, and placeholder reads as ready; false `no usage` with one latency point and an errors gate that never
  fired; the m365 labeled empty hiding failures and Retry; live strip figures spread into emptied usage cells; false zeros in Warden's
  queues and board; the empty declaration moved off Warden's rest anchor; a slope claim with no entries; the copy's off-by-one window.
- **Rounds:** `w33-r1` (all pages live, 1440 + 390, both schemes, plus the two m365 pane presets; shot after the served bundle carried
  the new strings, not on `/api/health` alone). `basalt-ui shot --base https://argo.jkrumm.com`, `argo-auth` seeded from
  `secrets-run read op://common/api/SECRET` via env, never printed or written. Boards: `.design-shots/w33-r1-{a,b,c,m365-labeled,m365-detail}`
  (gitignored). Four fresh `basalt-design-reviewer`s each given the w32 shots, plus a Keel side-by-side; verdicts in
  `docs/design/<page>.md` § "Wave 33 round"; basalt rows in `UPSTREAM.md` § "Wave 33".
- **Reviewer verdict, stated plainly:** **WalkingPad passes a seventh time.** Warden, Reading and Strength fail on basalt-only P0s (the
  strip-cell `data-shot-absent` row, basalt Wave 37); astro fails on basalt rows plus the rubric gap; Hermes on basalt plus one P2. Home,
  Agents, Garmin, Body composition, Calendar, Usage and M365 still carry argo state copy: the remaining empties without a reason, two
  wordings for one gap, Calendar's repeated per-row state, one false zero (usage errors). No lost fact except the reviewer's count of
  Hermes' 390 summary (one line of ~four words beside the tag column, where w32 showed two lines).
- **Against Keel:** close — Home, Agents, Garmin, Warden, Strength, Body composition, WalkingPad, Astro, Usage (at rest), M365; does not
  yet — Calendar (failure states), Reading, Hermes.
- **Not verified:** the m365 source-row focus ring (the focus crop lands on a chip); the 390 m365 detail pane with a source open; Body
  composition's empty headline (no empty crop of the summary); row hovers the harness cannot reach.
- **Boards NOT copied to the MacBook:** `iumac` timed out on port 2222 for the whole close-out (MacBook asleep or off the tailnet). The
  boards are in the main checkout's `.design-shots/w33-r1-*`; copy with
  `rsync -a .design-shots/w33-r1-* iumac:Downloads/argo-design-review/w33/` once it is reachable.
- **Cleanup:** worktrees and tabs removed with `rd fan --clean`; no background task left running.

## Wave 34 — Re-score round 13: one wording per gap, the last reasonless empties <!-- status: done -->

Same shape as Wave 33 (fan-out on disjoint page files, two independent reviews per PR, CI `check` green on the PR head before
`rd merge`, live re-shoot incl. the m365 pane presets once the served dashboard bundle carries the change, fresh
`basalt-design-reviewer`s with the w33 shots + a Keel side-by-side). **Subtract before you add**; a removal that leaves a reader without
a fact is a defect. Each page's detail is in `docs/design/<page>.md` § "Wave 33 round". WalkingPad passes: leave it; Reading, Strength
and Warden fail only on basalt rows: touch them only if a basalt release closes a row. Basalt rows (`UPSTREAM.md` § "Wave 28"–"Wave 33"):
no local workaround. The question rung stays frozen to its table; the authored producer `question` is an owner-approved backlog item in
warden and agent-gateway, not built — add nothing for it. A state is declared only where production renders it (`lib/shot-state.ts`);
under `empty` only the data is substituted.

- [x] The remaining reasonless empties and split wordings, fanned out: Home's ACWR cell (Garmin's training-load wording), the activity
      card's `Live` pulse / `0 updates` / burst caption and reasonless empty line, the meetings card's `Tasks: 0 …` under `empty`, the
      budget cell's poll age beside `Not reported yet`, the recovery footer's lone `observed` at 390; Agents' fleet cell (`Waiting for the
      first snapshot`, one wording) and the never-shown `None working` legend item; Garmin's dash-only fitness cell; Body composition's
      rate cell worded twice; Calendar's state stated once per card (not per day row), one wording per calendar failure across next-days,
      the week strip and Today with the source and next step, the week strip's empty reason, `Loading calendar` in three cards,
      `no events` vs `no meetings`; Usage's errors-half false zero under `empty`, the billing footer's missing action, the empty lists'
      top-set message and the tokens chart height; m365's chats / channels empty cells in one wording, the detail pane pointing at an
      empty list, the `All 0` chip over an empty list, the focus ring; Hermes' 390 tag column squeezing the summary; astro's `Site`
      label in the unknown-site copy, the raw site id, the altitude card's two wordings for one missed night.
- [x] If the orchestrator announces a basalt-ui release, bump it in its own commit before the re-shoot and re-check the rows it closes
      (the strip-cell `data-shot-absent` row would clear Reading, Strength and Warden).
- [x] Re-shoot all pages live and re-score; any page still below the bar gets a Wave 35 in this shape. The loop ends only when a
      fresh scorer and the owner find nothing worth improving.

**Left behind:**

**Closed out (orchestrated): Wave 35 is added as `active`, not spawned; the orchestrator spawns it.**

- **Landed (master, deployed, `/api/health` = `cd8201f`, Deploy + check workflows green):** five PRs, each with two independent
  agent-gateway review rounds, scope frozen after round 2, the last fix diff read by the lead, CI `check` green on the PR head before
  `rd merge`: #144 astro, #145 calendar, #146 home + agents + garmin + body composition, #147 usage + m365 + hermes, then #148 — the three
  regressions the `w34-r1` re-score found in this wave's own changes. `make check` green on merged master (1481 + 598 pass). Reading,
  Strength, Warden and WalkingPad untouched.
- **No basalt-ui release** was announced (2.22.0 is still the latest on npm), so no bump and no basalt row re-checked.
- **Fixed this round (verified live):** Home's ACWR empty uses Garmin's training-load wording; the activity card drops `0 updates`, the
  burst caption and the `Live` pulse with nothing to count, and its empty line names its producers; the tasks line has no measured zeros
  (none open / loading / failed); a partly unknown inbox never says `Nothing needs you`; `unavailable` lists failed reads only, no shot-only
  masks; Agents' fleet cell says `Waiting for the first snapshot` like its neighbours; Garmin's fitness empty says cause and next step and
  is reachable in production (a partial failure keeps the readings); Body composition's rate cell words its gap once; Calendar states
  loading / failure once per card, one failure wording (`{sources} failed to load`, the step once in the headline, a still-loading source
  named beside a failed one), `Nothing booked this week in {sources}`, one term `no events`, no false `no events` over all-day items
  (Calendar now "close" against Keel); Usage's health card states its gap once and never hides a real latency line, one filter-aware
  wording, the tokens card fills its cell; m365's strip empties in one wording, no `All 0` chip (chips stay under an active tag), the focus
  ring wraps the row shell; Hermes' 390 rows give title and summary the full width (w33's lost fact restored); astro's unknown-site copy
  names the site filter and quotes the requested id, and a missed night is worded once per screen.
- **What the lead caught before review:** astro's fix repeating the verdict headline in Tonight's timeline; calendar's full failure
  sentence five times on one screen; a `or widen the range` step on usage's fixed-30 d strip; m365's `refresh to retry` three times on one
  strip and a teams-empty branch that could fire while loading (it cannot: suspense reads); the Agents fleet cell repeating the alert's
  cadence; Home naming one failure `unavailable` and `failed to load`.
- **Code review caught:** shot-only masks on Home's `unavailable` / `decisions`; a pending source producing `Nothing needs you`; Garmin's
  fitness gap reachable only under the shot; the fitness cell hiding loaded readings on a partial failure; a mixed failed + loading
  calendar state dropping the loading source; `No events this week` false for all-day / cancelled-only weeks and `no events` over a
  live all-day item; usage's card-level empty hiding a real latency line; a persisted m365 tag left unclearable with the chips hidden.
  Declined with reasons: the `Live` pulse on a fresh empty feed (honest); per-card short state labels on calendar (the full sentence is
  once); the legend trim (#148 — the reviewer missed basalt's single-entry rule).
- **Regressions this wave introduced, found by the re-score and fixed in #148 (verified in `w34-r2`, 0 failed shots):** the Agents
  activity legend gone entirely (basalt renders a legend only with more than one entry — trimming to the states present hid the shade key);
  the m365 390 Detail pane zero-size under `empty` (2 P0 error shots); Home printing the no-snapshot sentence twice.
- **Rounds:** `w34-r1` (all pages, 1440 + 390, both schemes, plus the two m365 pane presets) after the served bundle carried the new
  strings; `w34-r2` (Home, Agents, m365 + the detail preset) after #148. `basalt-ui shot --base https://argo.jkrumm.com`, `argo-auth`
  seeded from `secrets-run read op://common/api/SECRET` via env, never printed or written. Boards: `.design-shots/w34-r1-{a,b,c,m365-labeled,m365-detail}`,
  `.design-shots/w34-r2-{a,m365-detail}` (gitignored). Four fresh `basalt-design-reviewer`s given the w33 shots plus a Keel side-by-side,
  a fifth for `w34-r2`; verdicts in `docs/design/<page>.md` § "Wave 34 round"; basalt rows in `UPSTREAM.md` § "Wave 34".
- **Reviewer verdict, stated plainly:** **WalkingPad passes an eighth time.** Garmin passes on this round's fixes (one P3). Warden, Reading
  and Strength fail on the basalt strip-cell P0 only; Body composition, Calendar, Hermes and astro fail on basalt rows (plus Hermes' P3
  placeholder wrap and astro's unscored double wording). Home, Agents, Usage and m365 still carry argo items, all P2/P3 except m365's
  carried P1 (the ~95 %-blank empty source list): Agents' one-swatch key (P2) and `None working` under empty, Home's cadence stated twice
  and a lower-case recovery empty, Usage's one sentence six times on the empty screen (P2 — "one wording per gap" against "no sentence
  repeated": the next wave decides the form) and the band under the tokens plot, m365's two wordings for no chats (P2), `refresh to retry`
  twice, the labeled pane pointing at an empty list. No lost fact after #148.
- **Against Keel:** close — Home, Agents (after #148), Garmin, Warden, Strength, Body composition, Calendar (new), WalkingPad, astro Tonight,
  Usage; does not yet — Reading (pace half), Hermes (void above the composer), m365 (rows without columns), astro Forecast (empty card
  without a title and action).
- **Not verified:** a partly-unknown Home inbox (no such shot state); the calendar headline's failure sentence (no loading / error page
  shot); Body composition's empty headline; the m365 source-row focus ring (the crop lands on a chip).
- **Boards NOT copied to the MacBook:** `iumac` timed out on port 2222 at both attempts (MacBook asleep or off the tailnet). The boards are
  in the main checkout's `.design-shots/`; copy with `rsync -a .design-shots/w34-* iumac:Downloads/argo-design-review/w34/` (and the w33
  boards, still uncopied, to `…/w33/`) once it is reachable.
- **Cleanup:** worktrees and tabs removed with `rd fan --clean`; no background task left running.

## Wave 35 — Re-score round 14: one form for a repeated gap, the last argo P2s <!-- status: done -->

Same shape as Wave 34 (fan-out on disjoint page files, two independent reviews per PR, CI `check` green on the PR head before
`rd merge`, live re-shoot incl. the m365 pane presets once the served dashboard bundle carries the change, fresh
`basalt-design-reviewer`s with the w34 shots + a Keel side-by-side). **Subtract before you add**; a removal that leaves a reader without
a fact is a defect — including a key or legend a basalt default hides (Wave 34's legend regression). Each page's detail is in
`docs/design/<page>.md` § "Wave 34 round". WalkingPad passes: leave it; Garmin passes on its fixes (one P3); Reading, Strength and
Warden fail only on basalt rows: touch them only if a basalt release closes a row. Basalt rows (`UPSTREAM.md` § "Wave 28"–"Wave 34"):
no local workaround. The question rung stays frozen to its table; the authored producer `question` is an owner-approved backlog item in
warden and agent-gateway, not built — add nothing for it. A state is declared only where production renders it (`lib/shot-state.ts`);
under `empty` only the data is substituted.

- [x] Settle the repeated-gap form once for all pages (usage's one sentence ×6 on the empty screen is the case): the full sentence with
      cause and next step once per screen, every other surface a short form of the same wording — the rule Calendar already follows —
      then apply it to usage, m365 (`No chats came back` vs the list's `No chats yet …`, `refresh to retry` twice, the labeled pane's
      `label a chat …` with no chats, the 390 Detail line without a step) and Home (the agent-gateway cadence twice, the lower-case
      recovery empty).
- [x] The remaining argo P2/P3s: Agents' one-swatch key for a graded range (a key that says darker = more), `None working` keyed under
      `empty`, the strip caption vs the alert's `No snapshot yet`, one size for `Waiting for the first snapshot`; usage's band under the
      tokens plot (basalt `fill` row — layout only) and the health card's height; m365's ~95 %-blank empty source list and the ring flush on
      the pane edge; Hermes' 390 placeholder wrap; astro's `{gap}° short` vs `core {gap}° under its gate`; Garmin's `RECOVERY —` kicker.
- [x] If the orchestrator announces a basalt-ui release, bump it in its own commit before the re-shoot and re-check the rows it closes
      (the strip-cell `data-shot-absent` row would clear Reading, Strength and Warden).
- [x] Re-shoot all pages live and re-score; any page still below the bar gets a Wave 36 in this shape. The loop ends only when a
      fresh scorer and the owner find nothing worth improving.

**Left behind:**

**Closed out (orchestrated): Wave 36 is added as `active`, not spawned; the orchestrator spawns it.**

- **Landed (master, deployed, `/api/health` = `ea535b0`, Deploy + check workflows green):** the repeated-gap rule settled in
  `docs/design/README.md` § "One form for a repeated gap" (`d83a400`, lead-owned); four PRs, each with two independent agent-gateway
  review rounds, scope frozen after round 2, the last fix diff read by the lead, CI `check` green on the PR head before `rd merge`:
  #149 astro, #150 home + agents + garmin, #151 usage + m365 + hermes, #152 the basalt-ui 2.23.0 adoption; the bump itself in its own
  commit (`eecd993`, `make check` green: 1507 + 598 pass). Reading, Strength, Warden and Body composition touched only by #152's
  2.23 adoption; WalkingPad untouched.
- **basalt-ui 2.23.0** (announced mid-wave by the orchestrator): bumped before the re-shoot; #152 adopted strip `shotAbsent` (Warden /
  Reading / Strength), retried both Wave 31 reverts — the default tooltip header (local `formatHeader` deleted) and `tone: 'muted'`
  (local flat fill deleted), both verified live — and the `period` list. Rows closed and the new 2.23 rows: `UPSTREAM.md` § "Wave 35".
- **Fixed this round (verified live):** Usage states its empty gap once in full and `No usage ingested` everywhere else, a filtered
  window keeps its own pair, and an empty 30 d strip speaks only for ranges inside it; m365 says one gap one way (`refresh to retry`
  once, `No chats or channels came back` on the labeled cell / pane), centres its empty list (w34's carried P1) and insets the focus
  ring; Hermes' 390 placeholder fits; Home names both feed producers with each cadence once and capitalises the recovery empty;
  Agents' key grades the range (`1–{n-1}` / `{n} agents working`), the caption says `No snapshot yet` only when none ever arrived,
  one size for the waiting line; Garmin's kicker drops the dash; astro words a missed night once (`core {gap}° under its gate` in the
  strip too) and the unknown-site card is a basalt `EmptyState`.
- **What the lead caught before review:** a `No snapshot yet` caption false when stale snapshots exist; Home dropping Warden's cadence
  (a lost fact); the legend's lighter swatch keyed `1 agent` for every intermediate cell; usage's filtered empty collapsed to `No usage
  ingested`; m365's labeled cell losing `or channels`; astro rewriting the historical w34 verdict; `pick another from Site` (the 390
  control is `Filters`).
- **Code review caught:** m365's two diverging "nothing to label" predicates; an empty strip collapsing a 90 d / all chart's sentence
  (losing `widen the range`); a lifted `openId` changing state lifetime; `{...props}` defeating narrowed props; the astro `8 − 7.95`
  float boundary rendering `0.0°`; the peak swatch drawn with a different colour expression than its cells. Declined with reasons: a
  `FEED_PRODUCERS` list (speculative); removing FleetStrip's no-snapshot branches (the lead's own round-2 call, withdrawn — the strip
  does render without a snapshot); restoring the deleted `formatHeader` / muted comment and dropping `shotAbsent` on #152 (2.23's
  MIGRATING and the live shot settle all three).
- **Rounds:** `w35-r1` (all pages + both m365 pane presets, basalt-ui 2.22.0, after #149–#151 were served) and `w35-r2` (the same set
  after #152 on 2.23.0, 0 failed shots — w35-r1 had 56, all the strip-cell row). `basalt-ui shot --base https://argo.jkrumm.com`,
  `argo-auth` seeded from `secrets-run read op://common/api/SECRET` via env, never printed or written. Boards:
  `.design-shots/w35-r1-{a,b,c,m365-labeled,m365-detail}` and `w35-r2-…` (gitignored). Six fresh `basalt-design-reviewer`s (three per
  round) given the previous round's shots plus a Keel side-by-side; verdicts in `docs/design/<page>.md` § "Wave 35 round".
- **Reviewer verdict, stated plainly (`w35-r2`):** **pass** — astro Tonight (first time; 2.23 moved the rubric gap), astro Forecast,
  Hermes, m365 (both presets), Reading (page; components only on basalt rows); Usage passes on the page with one basalt P1 (the
  `ViewTabs` radius 3). **Fail on argo items:** Home (P1 — `Nothing needs you` under no snapshot: `needsYouEmptyTitle` counts a settled
  read with no snapshot as known, production-reachable; P2 — the Garmin cadence twice), Warden (P1 — a fresh decision's `waiting 0 min`
  false zero), WalkingPad (P1 — bare `—` strip cells, failing only because the new rule bans them), Garmin (P2 — `Garmin syncs every
  {h} h` ten times on the empty screen; P3 — the fact line's `{Mon} {dd}` beside 2.23's `{dd} {Mon}` ticks), Calendar (P1 carried — the
  390 agenda rows wrap; P3 — three wordings for the empty week, a dash for a measured-zero free block), Strength (P1 carried — the 390
  scan), Agents (P3 — the waiting line vs the alert's short form), astro (P2 — under `empty` the night cards beside the unknown-site
  card; P3 — the `gate` orphan). Body composition fails on a new basalt P1 (the 390 rate qualifier truncated, a lost fact — UPSTREAM).
- **Against Keel:** close — Home, Agents, Garmin, Warden, Strength, Body composition, Calendar, astro Tonight and Forecast (new),
  m365 (new), Usage; does not yet — Reading (the pace half), Hermes (the void above the composer), WalkingPad (four dash tiles, w34
  close).
- **Not verified:** the usage filtered pair (no filtered shot); the Agents `No snapshot in the last {n} h` branch (no stale shot); the
  skinfold tooltip header (no caliper session renders); the 2.23 `craft-7` severity (no `detect.json`).
- **Boards to the MacBook:** w33 copied to `~/Downloads/argo-design-review/w33/`; w34 and w35 still copying at close-out (iumac was
  unreachable at the wave's start, then reachable over a ~35 MB / 10 min link; a first pass hit `unexpected end of file`). A detached
  resumable `rsync -a --partial` runs on the mini (log `/tmp/argo-boards-copy.XXXX.log`); if it dies, re-run
  `rsync -a --partial .design-shots/w3{4,5}-* iumac:Downloads/argo-design-review/<w>/` per week.
- **Cleanup:** worktrees and tabs removed with `rd fan --clean`; no in-session background task left running (the board copy is a
  detached process, above).

## Wave 36 — Re-score round 15: false all-clears, the rule's last breaks <!-- status: done -->

Same shape as Wave 35 (fan-out on disjoint page files, two independent reviews per PR, CI `check` green on the PR head before
`rd merge`, live re-shoot incl. the m365 pane presets once the served dashboard bundle carries the change, fresh
`basalt-design-reviewer`s with the w35-r2 shots + a Keel side-by-side). **Subtract before you add**; a removal that leaves a reader
without a fact is a defect. Each page's detail is in `docs/design/<page>.md` § "Wave 35 round" (the `w35-r2` bullet is the latest);
the binding wording rule is `docs/design/README.md` § "One form for a repeated gap". Hermes and m365 pass: leave them unless a fix names
them. Basalt rows (`UPSTREAM.md` § "Wave 28"–"Wave 35"): no local workaround. The question rung stays frozen to its table; the
authored producer `question` is an owner-approved backlog item in warden and agent-gateway, not built — add nothing for it. A state is
declared only where production renders it (`lib/shot-state.ts`); under `empty` only the data is substituted.

- [x] The false all-clears and false zeros: Home's `Nothing needs you` when a source settled with no snapshot (unknown, not nothing);
      Warden's fresh decision `waiting 0 min` beside its own `{n} min ago`; Calendar's dash for a measured-zero free block.
- [x] The rule's remaining breaks, fanned out: Garmin's cadence ×10 on the empty screen and Home's recovery / ACWR cadence twice (one
      shared Garmin pair); WalkingPad's bare `—` strip cells (the short form `No walks in the last 30 days`); Agents' waiting line vs the
      alert's `No snapshot yet`; Calendar's three wordings for the empty week (decide whether past week and next 7 days are one gap);
      m365's `No teams came back` vs `channels` and the 390 Detail line; Home's feed line vs its cells.
- [x] The carried argo P1/P2/P3s: Calendar's and Strength's 390 wraps (agenda rows; the scan's lift names and word-less status dot);
      Home's Warden activity rows wrapping; astro's night cards under `empty` beside the unknown-site card, the `gate` orphan, the raw
      site id; Garmin's ACWR fact-line date order (one locale source with 2.23's ticks); usage's footer step.
- [x] If the orchestrator announces a basalt-ui release, bump it in its own commit before the re-shoot and re-check the rows it closes.
- [x] Re-shoot all pages live and re-score; any page still below the bar gets a Wave 37 in this shape. The loop ends only when a
      fresh scorer and the owner find nothing worth improving.

**Left behind:**

**Closed out (orchestrated): Wave 37 is added as `active`, not spawned; the orchestrator spawns it.**

- **Landed (master, deployed, `/api/health` = `ef4c383`, Deploy + check green):** seven PRs, each with two independent agent-gateway
  review rounds, scope frozen after round 2, the last fix diff read by the lead, CI `check` green on the PR head before the merge:
  #153 warden + calendar + walking pad, #154 home + garmin + agents, #155 astro + strength + usage + m365 (first fan-out, after the
  `w35-r2` verdicts); #156 astro's shot-absent declarations (lead-owned, attribute only); #157 calendar + strength, #158 home + garmin +
  warden (second fan-out, after `w36-r1`); #159 home + calendar (third, after `w36-r2`). No basalt-ui release this wave (2.23.0 stays).
  Hermes, m365, Reading, Body composition untouched except where a fix named them (m365's two P3s in #155).
- **Fixed (verified live):** no false all-clear on Home (a source that settled with no snapshot is unknown: `No snapshot yet`, a neutral
  icon); Warden's `waiting 0 min` false zero (one clock with the history line, `<1 min` under a minute — unit-tested, not shot: no fresh
  decision in the live snapshot); Calendar's measured `0 min` free block; one Garmin gap pair (the cadence once per screen through one
  allocation, chart-only gaps included; `No recovery score in this {n} d window` on chart, strip and Home); day-month dates on Garmin;
  WalkingPad's window-bound cells take the short form; Agents' fleet cells say `No snapshot yet`; one calendar gap across week, today
  and the next 7 days (headline full, cells `No events`); one-line agenda and task titles; skeletons instead of `Loading` words; the
  strength 390 scan (one-line lift names, the status word, the velocity figure under it once its column folds); astro Forecast shows
  only the unknown-site card for an unknown site, no `gate` orphan, curly-quoted id; usage's leading sentence names its step; m365's
  channels noun and Detail line; Home's activity rows never cut a fact; Home's budget cell leads with the no-snapshot clause.
- **Regressions this wave caused and fixed inside it:** #154's one-line activity rows cut the item subject (`w36-r1`), #158's two-line
  rows cut the title / path / step (`w36-r2`) — closed by #159; #155's Velocity fold removed the 390 `%/mo` (closed by #157); #157's
  single Today skeleton bar (closed by #159, visually); #155's subtracted Forecast anchors undeclared (12 error shots, closed by #156).
- **What the lead caught before review:** chart-only Garmin gaps losing the cadence; the check icon on unknown needs-you titles; a
  `waiting` clock mixing the snapshot age with receipt time; DayGroups' `emptyWindow` no-op; a review's false "blocking"
  (`emptyWindowShort('all')`, the test passes) and a false harness claim (rest-declared `data-shot-absent` — the live metrics show
  `sky-panorama` shot `ok` at rest and `absent` under `empty`).
- **Code review caught:** `shortDate` throwing on a malformed day; the cadence allocated by sniffing rendered strings; a first-paint
  double full form (ledger in a passive effect); a calendar empty headline dropping the countdown; `isEmptyWindow` ignoring this week's
  past days; an unknown Today falling through to the event list; Home's budget cell inferring "no snapshot" from missing fields;
  dangling `·` separators; the m365 Detail pane's third spelling. Declined with reasons: last-loaded skeleton counts, per-actor feed
  refactors, CSS-duplication consolidation, Tooltip for truncated names (the full text stays in the DOM), moving date formatters.
- **Rounds:** `w36-r1` (all pages + both m365 presets, after #153–#155), `w36-r2` (Home, Garmin, Warden, Calendar, Strength, astro
  Forecast after #156–#158, 0 failed), `w36-r3` (Home, Calendar after #159, 0 failed). `basalt-ui shot --base https://argo.jkrumm.com`,
  `argo-auth` seeded from `secrets-run read op://common/api/SECRET` via env, never printed or written. Boards:
  `.design-shots/w36-r1-{a,b,c,m365-labeled,m365-detail}`, `w36-r2-{a,b,c}`, `w36-r3-a` (gitignored). Six fresh
  `basalt-design-reviewer`s, each given the previous round's shots plus a Keel side-by-side; verdicts in `docs/design/<page>.md`
  § "Wave 36 round"; new basalt rows in `UPSTREAM.md` § "Wave 36".
- **Reviewer verdict, stated plainly (latest round per page):** **pass** — Home (first time), Warden (first time), WalkingPad (back from
  w35's fail), astro Tonight and Forecast, Hermes, m365 (both presets), Reading, Usage (page). **Fail on basalt only** — Garmin (the 390
  legends on three charts, P1), Strength (four `Section` type sizes, P1), Body composition (the 390 rate qualifier, basalt Wave 38),
  Agents and Usage's charts (radius 3), Calendar (the measurer counts skeleton bars as empty, the crop is full). **No argo P0–P2 open.**
  Argo P3s left: Home's `·` leading a wrapped chip and cards 1 / 3's single action; Calendar's all-day-only day header and the step on
  failed cards; m365's `No chats came back` on the both-empty screen; astro's 390 fade on `under its gate`; WalkingPad's focus ring
  over `of target`; Reading's uneven rating bins.
- **Against Keel:** close — Home, Agents, Garmin, Warden, Strength, Body composition, Calendar, astro Tonight and Forecast, m365, Usage,
  WalkingPad (back from w35); does not yet — Reading (the pace tile has no visual), Hermes (the void above the composer).
- **Not verified:** Warden's sub-minute wait (no fresh decision in the snapshot), the calendar empty headline (no page-level `empty`
  anchor), the usage filtered pair, the Agents stale-snapshot caption.
- **Boards to the MacBook:** w34 and w35 confirmed complete on `~/Downloads/argo-design-review/` (rsync dry run: 0 pending). w36:
  **iumac unreachable at close-out** (reachable at 20:28, then `ssh … port 2222: Operation timed out` from 21:15; the first
  copy died mid-transfer). A detached resumable `rsync -a --partial --timeout=60` retries every 2 min for ~3 h (log
  `/tmp/argo-boards-w36b.*`); if it gives up, re-run `rsync -a --partial .design-shots/w36-* iumac:Downloads/argo-design-review/w36/`.
- **Cleanup:** all worktrees and tabs removed with `rd fan --clean`; no in-session background task left running (the board copy, if
  still retrying, is a detached process).

## Wave 37 — Re-score round 16: the argo P3s, then the basalt release <!-- status: done -->

Same shape as Wave 36 (fan-out on disjoint page files, two independent reviews per PR, CI `check` green on the PR head before the merge,
live re-shoot incl. the m365 pane presets once the served bundle carries the change, fresh `basalt-design-reviewer`s given the latest
w36 shots of each page + a Keel side-by-side). **Subtract before you add**; a removal that leaves a reader without a fact is a defect —
this wave's own two lost-fact regressions (activity rows, the 390 velocity) came from truncating to meet a line count. Each page's
detail is in `docs/design/<page>.md` § "Wave 36 round" (the last bullet is the latest); the binding wording rule is
`docs/design/README.md` § "One form for a repeated gap". Pages that pass: touch them only where an item names them. Basalt rows
(`UPSTREAM.md` § "Wave 28"–"Wave 36"): no local workaround. The question rung stays frozen; the authored producer `question` is an
owner-approved backlog item in warden and agent-gateway — add nothing for it. A state is declared only where production renders it.

- [x] The argo P3s: Home's `·` leading a wrapped chip (glue it to the chip) and cards 1 / 3's single action; Calendar's all-day-only
      day header without its `{n} events` fact and a step on each failed card (Keel puts the retry on the failed surface); m365's
      `No chats came back` on the both-empty screen (decide: a narrower gap with its own sentence, or the leading clause); astro's 390
      fade over `under its gate`; WalkingPad's focus ring over `of target`; Reading's uneven rating bins.
- [x] The two "does not yet" pages against Keel, concept first in their docs: Reading's pace tile (a micro-visual fitted to its data)
      and Hermes' void above the composer.
- [x] If the orchestrator announces a basalt-ui release (basalt Wave 38 carries the `ViewTabs` radius and the body-composition 390
      qualifier), bump it in its own commit before the re-shoot and re-check every row it closes.
- [x] Re-shoot all pages live and re-score; any page still below the bar gets a Wave 38 in this shape. The loop ends only when a
      fresh scorer and the owner find nothing worth improving.

**Left behind:**

**Closed out (orchestrated): Wave 38 is added as `active`, not spawned; the orchestrator spawns it.**

- **Landed (master, deployed, `/api/health` = the close-out commit, Deploy + check green):** eight PRs, each with two independent
  agent-gateway review rounds, scope frozen after round 2, the last fix diff read by the lead, CI `check` green on the PR head before
  `rd merge`: #160 home + calendar, #161 reading + hermes, #162 m365 + astro + walking pad (first fan-out, the w36 P3s); #163 usage +
  warden, #164 calendar, #165 reading + walking pad (second, after `w37-r1`); #166 calendar + reading (after `w37-r2`); #167 calendar +
  reading (after `w37-r3`). No basalt-ui release this wave (2.23.0 stays; `npm view` checked at each re-shoot). `make check` + `fallow
  audit` green on master at close-out.
- **Fixed (verified live):** Home's chip no longer opens a wrapped line with `·`; Calendar counts events one way everywhere (headers sum
  to the badge, all-day included, booked time timed-only), states an all-day-only day's count once, shows today's all-day items in the
  Today card, and every failure carries one step (a `Retry` under the headline for refetchable sources, `Retry` in Tasks, `Re-authorize`
  for Google, `Re-seed on the laptop: {command}` + `Copy command` for Microsoft 365) — the `— reload to retry` wording is gone; m365's
  both-empty screen names one gap on every surface incl. both phone panes; astro's 390 strip never fades a fact line; WalkingPad's focus
  ring clears `of target` and the phrase never splits; Reading's rating bins are even, labelled by star at the column centres, counts on
  one row, the mean marker on the same scale; Hermes' composer follows the list (no void inside the page); Usage names its full-day base
  and keeps tied hues stable; Warden prints one wait clock beside its history line.
- **Reverted inside the wave:** #161's local pace tick strip (a catalogue-banned hand-roll that turned Reading from pass to a P1 fail) —
  back to the w36 footer in #165; the slot distribution is an UPSTREAM row (`Bars` axis-less slot). Regressions caused and closed inside
  the wave: #161's 390 rating-label collision (#165), #165's edge ticks misplacing whole stars (#166), #166's marker over a count (#167),
  #164's Today card reading `No events` for an all-day-only today (caught in review, fixed before merge).
- **What the lead caught before review:** the m365 `gapLeader` change that made one screen speak two sentences (reverted — `No chats or
  channels came back` is true with teams but no channels); `<Code>` importing the open basalt radius-3 P1 into Calendar; `overflow-wrap:
  anywhere` splitting `gate`; counts riding on bars still crossable by the marker.
- **Declined with reasons:** a per-card Retry on the five calendar surfaces (one-form rule: the step lives once on the headline); a
  filler secondary on Home / Agents decision cards with nothing to copy; the reviewer's "lost pace distribution" (it was added this
  wave); fallow complexity refactors of `CalendarPage` / `HermesChatFeed` / walking-pad hooks; CSS-duplication consolidation.
- **Rounds:** `w37-r1` (all pages + both m365 presets after #160–#162; the presets re-shot after a harness seed fix — the store needs
  its `{v, value}` envelope), `w37-r2` (Calendar, Reading, WalkingPad, Warden, Usage after #163–#165), `w37-r3` and `w37-r4` (Calendar,
  Reading after #166 / #167). All 0 failed shots. `basalt-ui shot --base https://argo.jkrumm.com`, `argo-auth` seeded from `secrets-run
  read op://common/api/SECRET` via env, never printed or written. Boards: `.design-shots/w37-r1-{a,b,c,m365-labeled,m365-detail}`,
  `w37-r2-{a,b}`, `w37-r3-b`, `w37-r4-b` (gitignored). Ten fresh `basalt-design-reviewer`s, each given the previous round's shots plus a
  Keel side-by-side; verdicts in `docs/design/<page>.md` § "Wave 37"; new basalt rows in `UPSTREAM.md` § "Wave 37".
- **Reviewer verdict, stated plainly (latest round per page):** **pass** — Home, Reading (back from w37-r1's fail), WalkingPad, astro
  Tonight and Forecast, Hermes, m365 (default + both presets). **Fail on basalt only** — Garmin (390 legends, P1), Strength (four
  `Section` type sizes), Body composition (390 rate qualifier), Agents / Warden (`Code` radius 3), Usage (`ViewTabs` radius 3), Calendar
  (the measurer counts skeleton bars). **No argo P0–P2 open.** Argo P3s left: Calendar's `Nothing due in the next 7 days.` under an
  `overdue or due` scope; Agents' 390 running value sharing a line; Warden's 390 board crop on different live data (harness); m365 chat
  names ellipsized at 390 and the unshot chats-only gap; Home's activity rows at two to three lines (accepted).
- **Against Keel:** close — every page except Reading (the pace tile has no visual: basalt-owned now). Hermes moved to close.
- **Not verified:** the all-day-only Today card (no such day in the live data), the chats-only m365 gap, the Re-authorize / Copy command
  focus crops (error-only controls; focus is shot at rest), Home's decision path through `lib/decisions.ts` (outside this wave's files;
  it still builds the wait with the old formula — Warden's page uses the one-clock helper).
- **Garmin legend (orchestrator note):** `acwr-chart.tsx:155`, `recovery-trend-chart.tsx:115`, `stress-chart.tsx:125` pass `compact && {
  legend: false }`; basalt Wave 38 ships a one-row compact legend default. Delete those three lines in the basalt bump/adoption commit,
  not before the release.
- **Boards to the MacBook:** **iumac unreachable for the whole wave** (`ssh … port 2222: Operation timed out` at every attempt). A
  detached resumable copy retries every 2 min for ~3 h (log `/tmp/argo-boards-w37.bxY56W`; it copies `w37-*` and re-syncs `w36-*`). If
  it gives up: `rsync -a --partial .design-shots/w37-* iumac:Downloads/argo-design-review/w37/` and the same for `w36-*` into `w36/`.
- **Cleanup:** all worktrees and tabs removed with `rd fan --clean`; no in-session background task left running (the board copy is a
  detached process).

## Wave 38 — Re-score round 17: adopt the basalt release, the last argo P3s <!-- status: done -->

Same shape as Wave 37 (fan-out on disjoint page files, two independent reviews per PR, CI `check` green on the PR head before the merge,
live re-shoot incl. the m365 pane presets — seeded with the `{v:1, value:{…}}` envelope — once the served bundle carries the change,
fresh `basalt-design-reviewer`s given the latest w37 shots of each page + a Keel side-by-side). **Subtract before you add**; a removal
that leaves a reader without a fact is a defect, and a fix that turns a passing page into a failing one is reverted. Each page's detail
is in `docs/design/<page>.md` § "Wave 37" (the last bullet is the latest); the binding wording rule is `docs/design/README.md` § "One
form for a repeated gap". Basalt rows (`UPSTREAM.md` § "Wave 28"–"Wave 37"): no local workaround. The question rung stays frozen; the
authored producer `question` is an owner-approved backlog item in warden and agent-gateway — add nothing for it. A state is declared
only where production renders it.

- [x] When the orchestrator announces the basalt-ui release (basalt Wave 38: `ViewTabs` / `Code` radius, the body-composition 390
      qualifier, the one-row compact chart legend), bump it in its own commit; in that adoption commit delete Garmin's three
      `compact && { legend: false }` lines; re-shoot every page and re-check every row it closes.
- [x] The argo P3s: Calendar's `Nothing due in the next 7 days.` under the `overdue or due` scope; Agents' 390 running value sharing a
      line with `agent · longest {d}`; Home's decision wait through `lib/decisions.ts` on the one-clock rule Warden uses.
- [x] If basalt ships an axis-less `Bars` slot: Reading's pace tile as the catalogue's slot distribution (concept in `reading.md`).
- [x] Re-shoot all pages live and re-score; any page still below the bar gets a Wave 39 in this shape. The loop ends only when a
      fresh scorer and the owner find nothing worth improving.

**Left behind:**

**Closed out (orchestrated): Wave 39 is added as `active`, not spawned; the orchestrator spawns it.**

- **basalt-ui:** 2.23.0 → **2.24.0** (`d8f08ecc`, its own commit; adoption `0c88e404` deleted Garmin's three `compact && { legend:
  false }` lines) → **2.25.0** (`407f04da`, its own commit, nothing to migrate). Adopted: 2.24's strip cell `state: { kind: 'empty',
  reason }` on Garmin, Body composition, Home and Agents (the null `Meter` that only carried a reason deleted); `ZoneSpec.legend` on
  recovery and stress (recovery's always-`null` legend-only series deleted; ACWR keeps its keys — `Threshold` has no `legend`); the
  documented `--basalt-spark-readout-lift: 0` on Home's Meter-above-Sparkline cells; 2.25's slotted `Bars` for Reading's pace tile and
  `ChartCard placeholderHeight="content"` on Usage's list cards. Closed UPSTREAM rows are marked in place; the new rows are in
  `UPSTREAM.md` § "Wave 38" — three are **2.24 regressions** on pages that passed in w37 (the compact-legend `+N` fold hiding series
  names, the `Section` subtitle at 11 px, the `BandStrip` legend wrap), plus `StatStripFooterEntry` lacking `shotAbsent`.
- **Landed (master, deployed, `/api/health` = `697b77af`, Deploy + check green):** thirteen PRs, #168–#180, each with two independent
  agent-gateway reviews, scope frozen after round 2, the lead reading every fix diff, CI `check` green on the PR head before `rd merge`.
  The three P3s (#168 Home's wait on Warden's one clock, #169 Calendar's tasks scope + Agents' `longest {d}` line); the w38-r1 fixes
  (#170 astro timeline keeps a high moon's peak, #171 body comp / walking pad / strength, #172 garmin formula text, band legends, empty
  cells); #173 Home after the 2.24 regression; #174 / #177 the 2.25 adoption and Reading / Usage fixes; #175 / #176 schedule titles and
  history glue; #178 / #179 / #180 the w38-r3 / r4 regressions. `make check` green and `fallow audit` clean on master at close-out.
- **Regressions caused and closed inside the wave:** #173 collapsed Home's recovery cell at rest and dropped the budget's poller fact
  (fixed #178); #175's shared two-line title clamp broke Calendar's no-wrap criterion (reverted to opt-in, #176); #175's separator glue
  moved Warden's break into a state name (#176); #179 reverted the stress zone legend and lost the band names at 1440 (restored #180).
  Caught by the lead before merge: a worker reporting a strength change its diff did not contain (#171), the sun widening the astro
  axis (#170), the train failing after a rebase onto a new lockfile (the worktree had not reinstalled — `bun install` before `rd merge`).
- **Declined with reasons:** a width-gated stress legend (the 390 fold is basalt's row — no local workaround; the trade-off is recorded
  in `garmin-health.md`); restoring the activity-score `≈86/day` / weekly WHO wording (the 600 target is per day; that fact was false);
  `overflow-wrap: anywhere` on schedule titles (it splits ordinary words); the review's refactors (shared helpers, model moves, fallow
  complexity) — scope frozen.
- **Rounds:** `w38-r1` (all pages + both m365 presets on 2.24.0), `w38-r2` (Home, Agents, Warden, Calendar after #168 / #169),
  `w38-r3` (all pages + presets on 2.25.0 after #170–#175), `w38-r4` (Home, Agents, Garmin, Warden, Calendar, Reading, Usage after
  #176–#179), `w38-r5` (Garmin after #180). 0 failed shots except w38-r4's four `strip-footer-budget-poller` `empty` errors (basalt row).
  `basalt-ui shot --base https://argo.jkrumm.com`, `argo-auth` seeded from `secrets-run read op://common/api/SECRET` via env, never
  printed or written. Boards `.design-shots/w38-r{1..5}-*` (gitignored). Twenty-one fresh `basalt-design-reviewer`s, each given the
  previous round's shots plus a Keel side-by-side; verdicts in `docs/design/<page>.md` § "Wave 38 round".
- **Reviewer verdict, stated plainly (latest round per page):** **pass** — Home (back from two w38 regressions), Agents, Warden,
  Calendar (100, first pass since w35), Body composition, WalkingPad, astro Tonight and Forecast, Hermes, m365 (default + both
  presets), Usage. **Fail on basalt only** — Strength (four `Section` sizes, the `+N` fold), Reading (the backlog's 11 px subtitle).
  **Fail with an argo item** — Garmin: a scored recovery cell listing one of three contributors (P1, data-dependent) and the fitness
  `Improving` qualifier without a basis (P2), beside two basalt P1s.
- **Against Keel:** close on every page; Reading now **holds up** (the pace tile carries its visual — the last "does not yet").
- **Not verified:** a low astro night after #170 (only a high-moon night was live), the agent-wait `<1 min` wording, the budget with a
  known count but no cap, the API's cancelled flag without a title prefix, a rest-day tooltip hover.
- **Boards to the MacBook:** **iumac unreachable for the whole wave** (`ssh … port 2222: Operation timed out`). A detached resumable
  copy retries every 2 min for ~3 h (log `/tmp/argo-boards-w38.fUwIcn`) for `w38-*` into `w38/` and re-syncs `w37-*` / `w36-*`. If it
  gives up: `rsync -a --partial .design-shots/w38-* iumac:Downloads/argo-design-review/w38/` and the same for `w37-*` / `w36-*`.
- **Cleanup:** all worktrees and tabs removed with `rd fan --clean`; no in-session background task left running (the board copy is a
  detached process).

## Wave 39 — Re-score round 18: Garmin's argo items, the w38 P3s <!-- status: done -->

Same shape as Wave 38 (fan-out on disjoint page files, two independent reviews per PR, CI `check` green on the PR head before the merge
— `bun install` in each worktree after its rebase, live re-shoot once the served bundle carries the change, fresh
`basalt-design-reviewer`s given the latest w38 shots + a Keel side-by-side). **Subtract before you add**; a removal that leaves a reader
without a fact is a defect, and a fix that turns a passing page into a failing one is reverted. Page detail: `docs/design/<page>.md` §
"Wave 38 round" (the last bullet is the latest). Basalt rows (`UPSTREAM.md` § "Wave 28"–"Wave 38"): no local workaround. The question
rung stays frozen. A state is declared only where production renders it.

- [x] Garmin (argo): a scored recovery cell lists one of its three contributors with no reason for the missing two (P1, seen after a
      sync mid-run — make the cell state each missing contributor's gap, or the score's basis); the fitness qualifier `Improving`
      over two bad-coloured deltas with no stated basis (P2).
- [x] The w38 argo P3s: Home's recovery footer no longer says today is unscored, `Latest changes` ending a line on a bare `→`, the
      meeting footer ending on `·` at 390; Usage's p95 sparkline drawing the partial leading day its footer excludes (P2); Reading's
      `Book {i} of {n}` naming no title; Warden's mid-token title break; m365's unstable member order.
- [x] If the orchestrator announces a basalt-ui release, bump it in its own commit, adopt what closes `UPSTREAM.md` § "Wave 38" rows
      (the `+N` fold keeping series, the `Section` subtitle at 12, footer-entry `shotAbsent`), delete the matching local code.
      **Not triggered:** no release was announced during the wave; still on 2.25.0, carried to Wave 40.
- [x] Re-shoot all pages live and re-score; any page still below the bar gets a Wave 40 in this shape. The loop ends only when a
      fresh scorer and the owner find nothing worth improving.

**Left behind:**

**Closed out (orchestrated): Wave 40 is added as `active`, not spawned; the orchestrator spawns it.**

- **basalt-ui:** unchanged at **2.25.0** — no release announced during the wave (basalt Wave 38 was still in flight).
- **Landed (master, deployed, `/api/health` = `7c42aa06`, Deploy + check green):** four PRs, #181–#184, each with two independent
  agent-gateway reviews per round, two rounds then scope frozen, the lead reading every fix diff, CI `check` green on the PR head before
  `rd merge`. #181 Garmin: a scored recovery cell names its missing contributors and the score's basis (`recoveryBasis`); the API owns
  the fitness fit — `/fitness-direction` adds `rhrChange`/`hrvChange` (unrounded slope × index span) and `rhrFlat`/`hrvFlat` (the
  label's own threshold comparison), the rows render them (`flat · {change}` dimmed, last-minus-first fallback under 3 readings), the
  mirrored thresholds are gone. #182 Usage sparklines and the errors band draw `windowDays` (no partial leading day), footers keep
  `fullDays`; Reading's pace readout names the book (`shortTitle`, code-point safe, one `BookPace` cohort); m365 member names sort with
  a tie-break. #183 Home: the pre-sync recovery footer says today is unscored, `Latest changes` breaks before `→`
  (`transitionText(…, 'leading')`), the meeting footer's `·` is glued; Warden: `<wbr>` at identifier boundaries in board titles, the
  timeline header and decision-card subjects (`titleSegments` / `BreakableTitle`), Home's subjects too. #184 (round-2 fix): Garmin's
  basis line moves to the cell `footer` (four type sizes → three, a regression #181 caused, caught by `w39-r1`); Home's recovery
  series keeps a scored today (`recoveryWindow`), so the trend and `7 d mean` end on the headline's day. `make check` green on master.
- **Caught by the lead before merge:** the first usage fix dropped the running day from the sparklines (`fullDays`, a lost fact) —
  replaced by `windowDays`; Home's arrow first became one unbreakable `A → B · age` unit (overflow risk at 390) — moved to break before
  `→`; zero-width spaces in titles (copy/search pollution) — replaced by `<wbr>`; the client reconstructing the fitness fit from its
  own row count — moved into the API (both reviews, blocking).
- **Declined with reasons:** the regression fitting row index rather than calendar day (pre-existing, it drives the label too, so the
  rows agree with it — recorded as an open API item in `garmin-health.md`); the Garmin scorer's ten "empty has no next step" P1s (they
  contradict `docs/design/README.md` § "One form for a repeated gap": the step appears once per screen — the scorer was not given
  that rule; future scorer briefs must include it); the reviews' refactors (module moves to `lib/`, structured history parts, fallow
  complexity, an m365 `+N more` hint, colliding pace labels) — scope frozen; the shared `DecisionCard` `question` break (frozen-rung
  component, Wave 40 candidate).
- **Rounds:** `w39-r1` (all 13 routes + both m365 pane presets after #181–#183), `w39-r2` (Home, Garmin after #184). 0 failed shots
  except the four known `strip-footer-budget-poller` `empty` errors per Home round (basalt row). `basalt-ui shot --base
  https://argo.jkrumm.com`, `argo-auth` seeded from `secrets-run read op://common/api/SECRET` via env, never printed or written; shot
  only after the served bundle hash changed post-deploy. Boards `.design-shots/w39-r{1,2}-*` (gitignored). Sixteen fresh
  `basalt-design-reviewer`s with the previous round's shots + a Keel side-by-side (nine of them through a Workflow run, which this
  session should not have used without an explicit opt-in — same agents and cost as nine Agent calls); verdicts in
  `docs/design/<page>.md` § "Wave 39 round".
- **Reviewer verdict, stated plainly (latest round per page):** **pass** — Agents, Warden, Calendar, Body composition, WalkingPad,
  astro Tonight + Forecast, Hermes, m365 (default + both presets), Usage; Home passes on every component and fails only on the four
  harness error shots. **Fail on basalt only** — Strength (`+N` fold, `BandStrip` wrap, `Section` sizes), Reading (the 11 px `Section`
  subtitle). **Garmin** — fails on basalt rows plus the declined empty-state finding; its argo items from Wave 38 are closed and verified
  live.
- **Against Keel:** close on every page; Reading **holds up**.
- **Not verified (data-dependent):** Home's pre-sync `No score for today yet` caption (production was scored), the `flat` /
  `unchanged` / plain fitness branches, `<wbr>` in board-card titles and the timeline header (no board item or open timeline), a
  long-identifier subject that needs the break.
- **Boards to the MacBook:** **iumac unreachable again** (`ssh … port 2222: Operation timed out`). A detached resumable copy retries
  every 2 min for ~3 h (log `/tmp/argo-boards-w39.b02yaH`) for `w39-*` into `w39/` and re-syncs `w38-*`. If it gives up:
  `rsync -a --partial .design-shots/w39-* iumac:Downloads/argo-design-review/w39/`.
- **Cleanup:** all worktrees and tabs removed with `rd fan --clean`; no in-session background task left running (the board copy is a
  detached process).

## Wave 40 — Re-score round 19: the basalt release, the w39 P3s <!-- status: done -->

Same shape as Wave 39 (fan-out on disjoint page files, two independent reviews per PR, two rounds then scope frozen, CI `check` green on
the PR head before the merge — `bun install` in each worktree after its rebase, live re-shoot once the served bundle carries the change,
fresh `basalt-design-reviewer`s given the latest w39 shots + a Keel side-by-side **and `docs/design/README.md`'s settled rules**).
**Subtract before you add**; a removal that leaves a reader without a fact is a defect, and a fix that turns a passing page into a
failing one is reverted. Page detail: `docs/design/<page>.md` § "Wave 39 round" (the last bullet is the latest). Basalt rows
(`UPSTREAM.md` § "Wave 28"–"Wave 38"): no local workaround. The question rung stays frozen. A state is declared only where production
renders it.

- [x] When the orchestrator announces the basalt-ui release (basalt Wave 38: the `+N` fold keeping series names, the `Section`
      subtitle at 12, the `BandStrip` wrap, footer-entry `shotAbsent`), bump it in its own commit, adopt what closes the `UPSTREAM.md`
      § "Wave 38" rows, delete the matching local code, re-shoot every page and re-check every row it closes.
      **Done:** 2.26.0 announced and bumped (`36079dc0`), `shotAbsent` adopted (`87aa9d2f`), no local code made redundant.
- [x] The w39 argo P3s: Garmin's fitness qualifier naming its subject beside a declining VO2max row, the 390 basis line breaking before
      its `—`; Home's wrapped history row leaving its `from` state alone (reads as its own entry), the needs-you empty body repeating
      its title; Warden's facts line wrapping after a trailing `·`; WalkingPad's 390 week footer stranding its target icon, the week
      meter label repeating the hero, the Pace/Totals empty sentence repeating the reason; Agents' `ago` alone at 1440.
- [x] Owner decision, then build or drop: the shared `DecisionCard` `question` (`components/upstream/decision-card`) breaking a long
      identifier mid-token at 1440 — its `identifierRuns` keeps identifiers whole, which is the rung's own copy rule.
      **Orchestrator: BUILD** (a defect fix inside the frozen rung; nothing else added) — shipped in #186.
- [x] Re-shoot all pages live and re-score; **done in two passes:** the five changed pages (Home, Garmin, Warden, WalkingPad, Agents) are
      re-scored over `w40-r1`–`w40-r3`; after the bump, all 13 routes + both m365 presets in `w40-r4` (Strength again in `w40-r5`).
      Pages still below the bar get Wave 41 in this shape. The loop ends only when a fresh scorer and the owner find nothing worth
      improving.

**Left behind:**

**Closed out (orchestrated): Wave 41 is added as `active`, not spawned; the orchestrator spawns it.**

**Bump pass (after the 2.26.0 announcement):**

- **basalt-ui 2.26.0:** bumped in its own commit `36079dc0` (`bun install`, `basalt-ui sync` refreshed the managed block and manifest,
  nothing to migrate). Adopted: Home's `budget-poller` footer entry declares `shotAbsent: ['empty']` (`87aa9d2f`; the type is derived
  from `StatGroup`'s strip props because `StatStripFooterEntry` is not exported from the root — new UPSTREAM row). Deleted: nothing —
  argo worked around none of the § "Wave 38" rows, and Home's `--basalt-spark-readout-lift: 0` is still MIGRATING's opt-out.
- **Re-score `w40-r4` (all 13 routes + both m365 presets, 13 fresh reviewers):** argo found one P1 the bump uncovered — Strength's
  balance shell at four sizes from argo's own `xs` status lines in the ratios card, which 2.26 no longer masked — fixed in `8599a7f5`
  (`sm` dimmed), verified in `w40-r5` (11/13/15 everywhere, `detect` clean).
- **UPSTREAM § "Wave 38" re-check** (full table in `docs/design/UPSTREAM.md` § "Wave 40"): **closed** — the `+N` series fold, entry
  wrap, `Section` summary size, `BandStrip` wrap, legend order, first-point tooltips / `…` labels, the dark `Bars` chip, footer-entry
  `shotAbsent`. **Partly closed** — hosted `Sparkline` readouts (usage yes, garmin fitness no), `Meter` zone names at 390 (Home and body
  composition yes; Garmin load `Caution` and Agents `abandoned at 7 d` no). **New basalt rows:** the root export, the timeline's
  references folded at 390, hue-only zone folds, Home's 1440 zone names colliding, the taller activities tooltip leaving its card, the
  reading readout hanging below its card.
- **Verdicts (latest round per page):** **pass** — Home, Warden, WalkingPad, Calendar, Body composition, Reading, astro Tonight +
  Forecast, Hermes, m365 (default + both presets), Usage. **Fail on basalt only** — Garmin (load meter `Caution`, fitness readout),
  Agents (P2/P3 rows only), Strength (zone folds at 390). No argo P1/P2 left except Usage's data-dependent health-card P2 below.
- **Against Keel:** close on every page; Reading holds up.
- **Shots:** `.design-shots/w40-r4-{a,b,c}`, `w40-r4-m365-{detail,labeled}` (seed `basalt:m365-explorer` = `{"v":1,"value":{"pane":…}}`
  via `--local-storage …=@env:`), `w40-r5-a` (gitignored). Shot only after `/api/health` matched the pushed SHA and the served
  `index-*.js` hash changed. Shoot from a bash script (zsh does not word-split a flag string); a 4–5 route batch takes ~10–15 min.
- **Boards to the MacBook (bump pass):** `iumac` unreachable (port 2222 timed out); `rsync -a .design-shots/w40-* iumac:Downloads/argo-design-review/w40/`
  once it is back.

**P3 pass (before the release):**

- **basalt-ui:** was **2.25.0** during this pass.
- **Landed (master, deployed, `/api/health` = `db5ed43c`, Deploy + check green):** #185 Garmin (`fitnessQualifier`: `{label} · RHR/HRV
  slope · 14 d`; the basis line's `—` glued to the word before it); #186 Home + Warden + shared DecisionCard (Home's wrapped
  `Latest changes` rows hang their continuation; `needsYouEmptyBody` — no body under the all-clear, otherwise only the sources that
  failed / are loading / have no snapshot; question identifiers whole, long ones broken only at joints via `<wbr>`, one joint set in
  `lib/text-breaks.ts`, `TextRun` a discriminated union); #187 WalkingPad + Agents (week footer: target control inline and glued, `·`
  glued, nothing while loading; the meter's `so far` start caption dropped; quiet-list age glued); #188 (round-1 fixes from the live
  re-score: the project card's `Last activity` back on the breakable `formatAgo`, `waiting` glued to its duration in all three wait
  wordings); #189 (round-2 fix: the facts separator breaks before its `·`). Two independent agent-gateway reviews per PR per round, two
  rounds then scope frozen, the lead reading every diff, CI `check` green on each PR head before the merge. `make check` green on master.
- **Caught by the lead / the re-score before it stuck:** the WalkingPad worker shortened the Pace/Totals empty reason to `No walks`,
  breaking the settled verbatim short-form rule — reverted before merge and the w39 P3 declined; the first `needsYouEmptyBody` dropped
  which sources were loading / had no snapshot (round-2 review); `formatAgoWhole` on the project card truncated `Last activity` at 1440
  (`w40-r1`, P1, a passing page turned failing — reverted, the w39 `ago` P3 accepted); the both-sides `·` glue split `waiting` from its
  duration (`w40-r1`) and then, with every Warden fact already glued, left the whole facts line unbreakable so `times` split mid-word
  at 1440 (`w40-r2`, P1) — fixed by breaking before the dot (`w40-r3` clean).
- **Declined with reasons:** the w39 WalkingPad "Pace/Totals repeat the reason" P3 (`README.md` § "One form for a repeated gap"); an API
  `basis` field for the fitness qualifier (API change; the helper names its source); restoring `so far` (the cell says `This week` with a
  `to Mon` delta); dropping `overflow-wrap: anywhere` on the facts line (it only splits a word when a line has no other break); gluing
  Home/Agents fact internals in `lib/decisions.ts`, the agents `waiting 0 min` floor, `WARDEN_PUSH_MIN`'s export, the fallow complexity
  refactors, the touch-target size (all pre-existing, scope frozen).
- **Rounds:** `w40-r1` (Home, Garmin, Warden, WalkingPad, Agents after #185–#187), `w40-r2` (Agents, Warden after #188), `w40-r3`
  (Warden, Home after #189). 0 failed shots except the four known `strip-footer-budget-poller` `empty` errors per Home round. `basalt-ui
  shot --base https://argo.jkrumm.com` from the repo root (`--out` must sit inside the project), `argo-auth` seeded from `secrets-run read
  op://common/api/SECRET` via env, never printed or written; each round shot only after the served `index-*.js` hash changed post-deploy.
  A five-route run exceeds 10 min — shoot in batches of two or three, in the background. Boards `.design-shots/w40-r{1,2,3}-*`
  (gitignored). Nine fresh `basalt-design-reviewer`s (Agent calls, no Workflow), each given the previous round's shots, a Keel
  side-by-side and `README.md`'s settled rules; verdicts in `docs/design/<page>.md` § "Wave 40 round".
- **Reviewer verdict, stated plainly (latest round per page):** **pass** — Agents (`w40-r2`), WalkingPad (`w40-r1`). **Fail on
  basalt/harness only** — Home (`w40-r3`, the poller harness row), Warden (`w40-r3`, hover = rest, tooltips over cells, the strip
  qualifier after `·`), Garmin (`w40-r1`, the carried basalt rows). Pages not re-shot this wave keep their `Wave 39 round` verdicts.
- **Open argo P3s (carried into Wave 41):** Home — the `No snapshot yet from …` body opening with the
  title's words (accepted: only place the sources appear), decision-card-3's evidence `50` / `GB floor?` split at 390, the recovery
  footer ending on `·` at 390; Garmin — the 390 basis line leaving `only` alone; WalkingPad — the record header's last-walk line wrapping
  after a trailing `·` at 390.
- **Not verified (data-dependent):** a Home/Agents facts line that wraps, the agents-card `waiting` wording, the fitness `flat` /
  `unchanged` / plain branches, the WalkingPad loading footer.
- **Cleanup:** all worktrees and fan tabs reclaimed with `rd fan --clean`; no background task left running.

## Wave 41 — Re-score round 20: the argo items 2.26 left <!-- status: done -->

Same shape as Wave 40 (fan-out on disjoint page files, two independent reviews per PR, two rounds then scope frozen, CI `check` green on
the PR head before the merge, live re-shoot once the served bundle carries the change, fresh `basalt-design-reviewer`s given the latest
w40 shots + a Keel side-by-side and `docs/design/README.md`'s settled rules). **Subtract before you add**; a removal that leaves a reader
without a fact is a defect, and a fix that turns a passing page into a failing one is reverted. Page detail: `docs/design/<page>.md` §
"Wave 40 round" (the last bullet is the latest). Basalt rows (`UPSTREAM.md` § "Wave 28"–"Wave 40"): no local workaround. The question
rung stays frozen. A state is declared only where production renders it.

- [x] Usage (argo, P2): the health card's latency line draws the partial leading day the strip's `slowest day` excludes — apply the
      Wave 39 `windowDays` split there too. **Done:** #192.
- [x] The argo P3s: Home's recovery footer ending on `·` at 390 and decision-card-3's evidence `50` / `GB floor?` split; Garmin's 390
      basis line leaving `only` alone; WalkingPad's record header wrapping after `·` at 390; Reading's 390 ratings footer `… on` /
      `4 of them` (no noun); Agents' long `Now` title ellipsizing at 1440. **Done:** #190, #191, #192, #193.
- [x] If the orchestrator announces a basalt-ui release, bump it in its own commit, adopt what closes the `UPSTREAM.md` § "Wave 40" rows,
      delete the matching local code. **Done:** basalt-ui 2.27.0, `52054469`; nothing to adopt, no local code to delete.
- [x] Re-shoot the changed pages live and re-score (all pages after a bump); any page still below the bar gets a Wave 42 in this shape.
      The loop ends only when a fresh scorer and the owner find nothing worth improving. **Done (argo pass):** `w41-r1`, six pages.
      After a bump the all-page re-shoot reopens with the bump step.

**Left behind:**

**Closed out (orchestrated, bump pass): Wave 41 is `done`; no Wave 42 is authored — the open items are basalt's.**

- **basalt-ui 2.27.0:** bump in its own commit `52054469`; `sync` refreshed the managed block, MIGRATING § 2.27.0 needed nothing from argo
  (no `foldLegend` / `+N` code, no facts card needing the new `state` gate, no local code made redundant). Landed on master and deployed
  (`/api/health` = `4e3840a2`, served bundle hash changed before each shoot). `make check` green on each commit.
- **argo-owned find, fixed:** the Map tab's legends sat under MapLibre's expanded attribution strip at 390 and lost their last lines
  (`4e3840a2`, `bottom` 8 → 44 on `LpLegend` / `WeatherLegends`; first try `32` still clipped `(2025)`). Re-shot `w42-r3-map`: clean at
  390 and 1440. The Map tab had no earlier round, so this is not a 2.27 effect.
- **Verdicts (`w42`, 12 fresh reviewers, each given the previous round's shots, Keel and `README.md`):** **pass** — Home 93, Agents 92,
  Warden 92, WalkingPad 100, Calendar 97, Body composition 96, Reading 99, Usage 95, Strength 90 (reviewer read 4 of 13 sheets; treat as
  provisional), Hermes 98, astro Tonight 94 + Forecast 94 + Map (fail 87 on the legend, fixed and verified above), m365 detail 94 +
  labeled 93. **Fail on basalt only** — Garmin 71: the fitness readout lands on the HRV row's line at 390 (P1, Fitness cell and joined
  strip). No argo P1/P2 left except Home's next-meeting footer ellipsizing the title (P2, argo, data-dependent — the title is long;
  not changed this wave). No regression on a passing page, no lost fact. Against Keel: close everywhere, unchanged.
- **UPSTREAM § "Wave 40" re-check** (table in `docs/design/UPSTREAM.md` § "Wave 41 bump"): **closed** — Garmin `Caution` at 390, Agents
  `abandoned at 7 d`, zone names at 1440 incl. dark `Optima`, hue-only zone folds, the activities tooltip, the reading readout, strip
  footer alignment. **Open** — the fitness readout (worse at 390), info bubbles over headlines, hover = rest, stranded `·` qualifier,
  `PR` label, `Sept` / `Sep`, `$0` rows. **New basalt P3s:** `warn at 24 h` / `abandoned at 7 d` stacked nearly touching; the Bars chip
  touching its focus ring; the activities tooltip covering the headline facts.
- **Shots:** `.design-shots/w42-{a,b,c,d,e}`, `w42-m-{detail,labeled}`, `w42-r{2,3}-map` (gitignored, 0 failed). The default m365 pane was
  not re-shot as its own preset. Boards not copied to the MacBook.
- **Not verified:** the m365 default pane at 390, hover / tooltip states of the 2.27 hosted Sparkline readout on Usage and Walking (no
  crop declares them), a wrapping `Now` title.
- **Cleanup:** no worktree, tab or background task left; no token written anywhere.

**Stopped earlier (orchestrated): the argo steps were closed, the bump step was open — no basalt-ui release was announced during this wave.**
Wave 41 stays `active`; no Wave 42 is authored (no argo item is left to put in it). When the orchestrator announces the release: bump
in its own commit, adopt what closes `UPSTREAM.md` § "Wave 40" (Garmin load `Caution` at 390, Agents `abandoned at 7 d`, zone names at
1440 incl. dark `Optima`, hue-only zone folds, the fitness readout, the activities tooltip, the reading readout, the root export),
delete the matching local code (none known), re-shoot all 13 routes + both m365 presets, re-score, then flip this wave.

- **basalt-ui:** 2.26.0 throughout (no release announced).
- **Landed (master, deployed, `/api/health` = `cc6a62f4`, Deploy + check green):** #190 Agents (project card `Now` / `Waiting` title
  wraps instead of ellipsizing; `nowValue` — `min-width: 0; overflow-wrap: anywhere` — in `project-cards.module.css`); #191 Garmin +
  WalkingPad (basis line glues `only`; the record header joins facts/stats with the shared `FACT_SEPARATOR`); #192 Usage + Reading (the
  health card draws window days only via `rangeWindowDays` in `model.ts`, `windowDays` takes an explicit span — `STRIP_WINDOW_DAYS` at
  the strip — and `hasCalls` reads the windowed rate buckets; ratings footer `community mean 4.2 ★ on 4 books`); #193 Home + shared
  DecisionCard (`FACT_SEPARATOR` moved to `lib/text-breaks.ts` and used by the recovery footer; `glueNumberUnits` glues number→unit on
  the evidence line at render time). Fan-out of four workers (`rd fan`), two independent agent-gateway reviews per PR, two rounds then
  scope frozen, the lead reading every diff, CI `check` green on each PR head, `rd merge`. `make check` green on master.
- **Caught by the lead before merge:** the WalkingPad worker wrote a second copy of the ` ·NBSP` joint (`joinFacts`) — rebased onto #193
  and switched to `FACT_SEPARATOR`, then the wrapper removed (round-2 review); the Agents title without `truncate` would have
  overflowed on a long unbroken token (flex item, `min-width: auto`) — `overflow-wrap: anywhere` added.
- **Declined with reasons:** consolidating the range→days tables across features, renaming `windowDays`, the `useNow` tick, moving
  the evidence glue into the producers (the card already does render-time identifier breaking), deriving units from `format.ts` (no unit
  list there), renaming `text-breaks.ts`, moving `recoveryFooter`'s join to the renderer (every footer is a model-built string), exporting
  walking-pad's `plural`, extracting `liveWalkFacts`, every fallow complexity refactor (scope frozen).
- **Verdicts (`w41-r1`, six fresh reviewers, each given the w40-r4 shots, the Keel shots and `README.md`):** **pass** — Home (95), Usage
  (97, the P2 closed: line opens ~45 s, peak matches `slowest day 65.3 s`), Reading (99), WalkingPad (100), Agents (93). **Fail on basalt
  only** — Garmin (49: load meter `Caution` at 390 P1 and the carried rows; argo clean). No argo P1/P2/P3 left except the accepted
  ones (Home's `No snapshot yet from …` body, Agents' `ago` alone at 1440). No regression, no lost fact. Pages not re-shot keep their
  `w40-r4` verdicts. Against Keel: close everywhere, Reading holds up. Detail: `docs/design/<page>.md` § "Wave 41 round";
  `UPSTREAM.md` § "Wave 41".
- **Not verified (data-dependent):** a wrapping `Now` / `Waiting` title and `overflow-wrap` on a lone token (no live title long enough),
  the evidence-line unit glue at a wrap, the live-walk row, the other Garmin basis branches, usage week grain / `all`.
- **Shots:** `.design-shots/w41-r1-{a,b}` (gitignored; 0 failed, `detect` clean). Shot after `/api/health` matched `cc6a62f4`. The
  `argo-auth` seed is zustand's persisted JSON `{"state":{"token":…},"version":0}`, built inside the shoot script from `secrets-run read
  op://common/api/SECRET` into `--local-storage argo-auth=@env:ARGO_AUTH` (never printed or written) — a bare token seeds nothing and
  every page shoots the login screen (`no data-shot anchors`). Two parallel 3-route batches took ~6 min.
- **Cleanup:** worktrees and fan tabs reclaimed with `rd fan --clean`; no background task left running.

## Wave 42 — Re-score round 21: basalt-ui 2.27.1 <!-- status: done -->

basalt-ui 2.27.1 (basalt Wave 40) is a patch with nothing to migrate: #458 keeps a strip-row `Sparkline` hosted readout on one
line inside its own row at 390 (Garmin's fitness P1); #457 puts a gap between stacked `Meter` caption rows, keeps the slotted
`Bars` chip clear of its focus ring and keeps chart tooltips off the card's headline facts. Budget is tight: one round, no
scope beyond these steps. Basalt rows get no local workaround.

- [x] Bump basalt-ui to 2.27.1 in its own commit.
- [x] Once the served dashboard bundle carries the bump: re-shoot Garmin, Home, Agents and Reading (1440 / 390, both schemes)
      and re-score them with fresh `basalt-design-reviewer`s given the w42 shots + Keel.
- [x] Re-check the `UPSTREAM.md` § "Wave 41 bump" rows these fixes close; record any regression as a basalt row.
**Left behind:**

**Closed out (orchestrated): Wave 42 is `done`; no Wave 43 is authored — the open items are basalt's.**

- **basalt-ui 2.27.1:** bumped in its own commit `01f0c1d9`; `sync` refreshed the managed block, nothing to adopt or delete. Deployed
  (`/api/health` = `01f0c1d9`) before shooting. `make check` green (609 tests).
- **Verdicts (`w43-a`, `w43-b`, fresh reviewers, each given the w42 shots):** **pass** — Home 97, Agents 92, Reading 90 (basalt P1: the
  pace `Bars` chip still touches its focus ring and is clipped; `#457`'s chip fix did not land in the shot). Garmin 55 (**fail on basalt
  only**): the fitness readout P1 is closed, but the info popover still covers the headline on ACWR, Recovery and Activity score (P1,
  unchanged from w42) and ACWR draws its date axis twice (carried). No regression, no lost fact. Rows: `UPSTREAM.md` § "Wave 42 bump".
- **Closed by 2.27.1:** fitness readout at 390, Meter caption gaps (Agents, Home, Garmin), Home ACWR zone names. **Still open:** the
  Reading chip/ring, info popovers over headlines, the activity-strip focus readout over its footer.
- **Process note:** a first `make design-shot` round was scored by reviewers and rejected (no `metrics.json`; that harness is not the
  reviewer's input). Only `basalt-ui shot` out dirs feed the scorer; the verdicts above are from those.
- **Not verified:** Garmin dark mobile crops one by one; hover/tooltip states for Home (none declared).
- **Shots:** `.design-shots/w43-{a,b}` (0 failed; gitignored), plus the discarded `w43-bump`. No token written; no background task left.


## Wave 43 — Re-score round 22: basalt-ui 2.27.2 <!-- status: done -->

basalt-ui 2.27.2 (basalt Wave 41, argo friction VI) is a patch with nothing to migrate: #461/#463 open the info bubble below
the card's header block so it never covers the headline facts (Garmin ACWR, Recovery, Activity score); #462 keeps the slotted
`Bars` chip clear of the plot's focus ring and swatch, with one home for the chart ring (Reading's pace tile). This is the last
wave before a pause for the owner's weekly limit: one round, no scope beyond these steps. Basalt rows get no local workaround.

- [x] Bump basalt-ui to 2.27.2 in its own commit.
- [x] Once the served dashboard bundle carries the bump: re-shoot Garmin and Reading (1440 / 390, both schemes) with
      `basalt-ui shot` (only its out dirs feed the scorer) and re-score them with fresh `basalt-design-reviewer`s given the
      w43 shots + Keel.
- [x] Re-check the `UPSTREAM.md` § "Wave 42 bump" rows these fixes close; record any regression as a basalt row.
**Left behind:**

**Closed out (orchestrated): Wave 43 is `done`; no Wave 44 is authored.**

- **basalt-ui 2.27.2:** bumped in its own commit `eaff7a7b`; `sync` refreshed the managed block, nothing to adopt. `make check` green (609 tests). Deploy run succeeded and `/api/health` = `eaff7a7b` before shooting (the bundle carries no version string; deploy success is the evidence).
- **Verdicts (`w44-a`, `w44-b`, fresh reviewers, each given the w43 shots):** **pass** — Reading 94 (#462 closed: pace chip clear of the ring, unclipped). **Fail on basalt/carried only** — Garmin 82 (up from 55): the info-popover P1 is closed on ACWR, Recovery and Activity score; ACWR still draws its date axis twice (P1, carried). No regression, no lost fact. Rows: `UPSTREAM.md` § "Wave 43 bump".
- **Argo items (not fixed, scope frozen):** Garmin card titles carry no period (P2 copy); orphaned `· ` when a headline wraps at 390 (P3).
- **Not verified:** Keel captures not opened by either reviewer; Reading's non-pace anchors and Garmin's light-mobile/dark-desktop page shots were read from metrics only; no `detect.json` run.
- **Shots:** `.design-shots/w44-{a,b}` (0 failed; gitignored), shot with `--base https://argo.jkrumm.com`, auth seeded via env from `secrets-run`, never printed or written. No background task left.


## Wave 44 — Garmin: one date axis on ACWR <!-- status: done -->

The last open P1 on the last failing page: Garmin's ACWR card draws its date axis twice, because the ratio line chart is
stacked over the delta bars and both carry `xTicks` (`apps/dashboard/src/features/garmin-health/charts/acwr-chart.tsx`, the
two `xTicks={xTicks}` props). The basalt lead's reading (basalt `mother.md`): the upper chart drops its axis with `xTicks={[]}`.
This is argo's composition, not a basalt row. Last wave before the owner's weekly-limit pause: one change, one round.

- [x] Keep one date axis on the ACWR card (the lower chart, the one at the card's bottom edge), confirm the two plots still
      share the x domain so the days line up, and add a test if the chart module has one. Check/test green, direct to master.
- [x] Once the served bundle carries it (and not before): re-shoot Garmin with `basalt-ui shot` (1440 / 390, both schemes)
      and re-score it with a fresh `basalt-design-reviewer` given the w44 shots + Keel. A pass makes argo 14 of 14.
**Left behind:**

**Closed out (orchestrated): Wave 44 is `done`; no Wave 45 is authored.**

- **Change:** the ratio line's `xTicks={[]}` in `acwr-chart.tsx`, commit `2cf05011`; the delta strip keeps the one date axis. Shared `xDomain` untouched. `make check` green (609 tests); no chart test exists for the module. Deploy succeeded and `/api/health` = `2cf05011` before shooting.
- **Verdict (`basalt-ui shot`, fresh reviewer, 0 failed):** **pass, Garmin 95** (up from 82), every component pass. The doubled date axis is closed in all schemes and viewports; no lost fact, no regression. **Argo is 14 of 14.**
- **Noted, not fixed (scope):** the line spans the plot edge to edge while the bars and ticks sit on band centres, so the two plots differ by up to ~half a day at the ends (~17 px at 1440), and the 29 delta bars start a day after the 30 line points; `strip-load` scale label "0" reads under the marker (P2); empty-state wording and the Sleep score / Body battery net lacking an info icon (P3).
- **Not verified:** the previous w44 shots were not opened by the reviewer (comparison rests on the prior verdict); no `detect.json` run.
- **Shots:** `apps/dashboard/.design-shots/w45` (gitignored). Auth seeded via env from `secrets-run`, never printed or written. No background task left.

## Wave 45 — Strength: a complete re-score <!-- status: done -->

Strength's pass (90, w42) is provisional: its reviewer read 4 of 13 sheets. No code change is planned; this wave makes the
14-of-14 verdict real. Budget is tight (the owner's weekly limit): one round.

- [x] Re-shoot Strength with `basalt-ui shot` (1440 / 390, both schemes) on the live 2.27.2 bundle and re-score it with a fresh
      `basalt-design-reviewer` told to read EVERY sheet and given the w42 shots + Keel. Record the verdict per component in
      `docs/design/strength.md`. A basalt finding is an `UPSTREAM.md` row; an argo P1/P2 is named in Left behind, not fixed here.
**Left behind:**

**Closed out (orchestrated): Wave 45 is `done`; no Wave 46 is authored.**

- **Verdict:** Strength **pass, 68** from a fresh reviewer that read all 13 sheets + 4 page shots (`apps/dashboard/.design-shots/w45-strength`, 0 failed, gitignored). No P0/P1; every component pass. The 90 → 68 drop is coverage and carried items now counted, not a regression. Argo is 14 of 14 on a complete read. Recorded in `docs/design/strength-tracker.md` (the plan said `strength.md`; that file does not exist) and `UPSTREAM.md`.
- **Argo items (named, not fixed, no code this wave):** P2 — Estimated 1RM unlegended dashed companion line and dot; scan folds Volume/INOL at 390 (lost fact); "Balance" title scope; accent on the selected timer preset; dark Warm-up bars low contrast; scan/Log/Timer/Recent and expanded diagnostics/alignment have no anchor. P3 — "90-day norm" vs "all time" caption, scan title period, duplicated "Daily 62"/"Garmin Recovery 62" and unitless "Fatigue debt".
- **Not verified:** Keel not read, no `detect.json`; the w42 shots are gone from disk, so the comparison is to the recorded verdict; ~90 single crops judged from their sheets.
- **Shots:** auth seeded via env from `secrets-run` (zustand `argo-auth` JSON), never printed or written. No background task left.

## Wave 46 — Strength's argo P2s <!-- status: done -->

From Wave 45's complete 13-sheet re-score (`docs/design/strength-tracker.md`, `UPSTREAM.md` § "Wave 45"). Same shape as Wave 38
(fan-out on disjoint files, two independent reviews per PR, CI `check` green on the PR head before the merge, `bun install` in a
worktree after its rebase, live re-shoot once the served bundle carries the change, fresh `basalt-design-reviewer`s told to read
every sheet). **Subtract before you add**; a removal that leaves a reader without a fact is a defect. Basalt rows: no workaround.

- [x] The lost fact first: the scan folds Volume/INOL at 390 — keep both figures readable at the phone width.
- [x] The Estimated 1RM dashed companion line and dot get a legend entry (or a direct label), so no mark is unexplained.
- [x] The "Balance" title names its scope; the selected timer preset uses the selected-state token, not the accent; the dark
      Warm-up bars reach the contrast floor.
- [x] Shot anchors for scan, Log, Timer, Recent and the expanded diagnostics/alignment, so the scorer sees them.
- [x] The P3s if cheap: the "90-day norm" vs "all time" caption, the scan title's period, the duplicated "Daily 62" /
      "Garmin Recovery 62", the unitless "Fatigue debt".
- [x] Re-shoot Strength (1440 / 390, both schemes) and re-score it with a fresh reviewer reading every sheet.
**Left behind:**

**Closed out (orchestrated): Wave 46 is `done`; no Wave 47 is authored.**

- **Changed (master, deploy green and live before each shoot):** the scan at 390 keeps Volume and INOL as labelled mini-sparklines under the lift name (`6fbafe2e`; the first cut widened the lift column and folded Velocity/Status, caught by the first reviewer and fixed in `8fc99a95` by stacking the minis at 44 px, verified on the live shot); Estimated 1RM `subtitle` explains the dashed 30-day line and PR dot; `Balance, <period>`; the selected timer preset is `VX.surface.rowSelected` + bold, not an accent fill; Warm-up opacity .3 to .4; anchors `strength-scan` / `strength-log` / `strength-timer` / `strength-recent`; P3s: the readiness tooltip drops "Garmin Recovery" when it equals the daily score, the diagnostics summary reads `Window: <period>` (`7b52a2ea`). `make check` green (609 tests).
- **Verdict (`w46-strength` fail 23, then `w46-strength-b` fail 19; fresh reviewers, all sheets read, 0 failed shots):** every Wave 46 target met and no lost fact at 390, but three components fail on contrast. **Not fixed, named:** P0 light-scheme green delta ink (`#29a634` on card, 2.9-3.05:1; scan and strips) and the Log set table's header/"Previous" ink (1.9-2.3 light, 2.7-3.6 dark); P1 dark Warm-up vs Drop bars/legend near-identical (one `exColor` at .4/.6 opacity; needs distinct shades). The w45 pass (68) did not flag these rows and no baseline shot dir exists, so they may be newly measured rather than new. Candidate basalt ink-token rows, not confirmed from source.
- **P2:** the 390 scan delta lacks the up/down glyph and the Vol/INOL minis carry no unit; `PR` label on the sparkline in two strips (basalt, carried); `strength-log`/`strength-timer`/`strength-recent` are not captured at 390 (under the Train tab, which the shot never opens); expanded diagnostics/alignment still have no anchor (collapsed by default).
- **Not verified:** the `Window:` copy edit was not re-shot; no `detect.json`, no Keel read. Shots in `apps/dashboard/.design-shots/w46-strength{,-b}` (gitignored). Auth seeded via env from `secrets-run`, never printed or written. No background task left.

## Wave 47 — Strength contrast <!-- status: done -->

From Wave 46's verdict (Strength fail 19–23 on contrast only). Both causes are argo code, traced:

- [x] P0, the green delta ink: `features/strength-tracker/formulas.ts:38` `directionColor('improving')` returns
      `ZONE_COLORS.excellent` → `VX.status.excellent`, a chart FILL (`forest[2]` `#29a634`, ~2.9:1) that basalt's text solver
      never tunes. Text must use `VX.status.good` (solver-tuned) — fix `directionColor` (or split a text vs fill helper) and its
      text call sites (`charts/momentum-chart.tsx:110/116`, `charts/sparkline-grid-chart.tsx:176/204`); fills keep `excellent`.
- [x] P0, the Log set table: the header (`components/set-editor.module.css:19`, `--vx-neutral` at 50 % alpha) and the
      "Previous" cells (`components/set-editor.tsx:223`, `alpha(VX.neutral, 0.4)`) fade a chart neutral instead of using the
      ink ramp; the dimmed-row `opacity: 0.5` halves it again. Use `VX.muted` / `var(--vx-muted)` (or `c="dimmed"`) and keep the
      dimmed-row cue without dropping text below 4.5:1 (measure it in both schemes).
- [x] P1, dark Warm-up vs Drop bars/legend: one `exColor` at .4/.6 opacity reads as one series. Give them distinct shades.
- [x] Re-shoot Strength (1440 / 390, both schemes) and re-score it with a fresh reviewer reading every sheet.
**Left behind:**

**Closed out (orchestrated): Wave 47 is `done`; no Wave 48 is authored.**

- **Changed (master `d47f57bf`, deploy green and live before the shoot):** `directionColor` returns the solver-tuned `status.good` for text, new `directionFill` keeps `excellent` for the sparkline-grid dot; Log header and "Previous" ink use `--vx-muted`, dimmed rows recolour instead of halving opacity; Warm-up is `VX.neutral`, Drop the lift hue, both at .55. `make check` green (609 tests).
- **Verdict (`w47-strength`, fresh reviewer, all 17 anchors + 4 page shots, 0 failed): fail, 83** (up from 19-23). All three w46 contrast items closed (min contrast 4.9:1, no failures). One P1 left: `strength-log` has four font sizes (11/12/13/15, limit three). P2: the page H1 "No scored e1RM in 28 d" sits above strips that show e1RM values; log/timer/recent are not captured at 390. P3: stray dot beside the 390 Vol/INOL minis. Recorded in `docs/design/strength-tracker.md`.
- **Not verified:** no `detect.json`, no Keel read, bar-segment contrast judged by eye. Shots in `apps/dashboard/.design-shots/w47-strength` (gitignored); auth seeded via env from `secrets-run`, never printed or written. No background task left.

## Wave 48 — Strength: the last P1 and P2s <!-- status: done -->

From Wave 47's verdict (Strength fail 83; contrast closed, min 4.9:1). Detail: `docs/design/strength-tracker.md` § Wave 47.

- [x] P1: `strength-log` holds four font sizes (11/12/13/15; the limit is three). Find which is argo's own (a raw `size`, a
      class) and fold it onto the shell's steps; if a basalt slot forces the fourth, record it as an `UPSTREAM.md` row instead.
- [x] P2: the page H1 "No scored e1RM in 28 d" contradicts the strips below that show e1RM values — make the headline state
      what the page actually has (one fact, one form).
- [x] P2: capture log / timer / recent at 390 (shot anchors per viewport). P3: the stray dot beside the 390 Vol/INOL minis.
- [x] Re-shoot Strength (1440 / 390, both schemes) and re-score it with a fresh reviewer reading every sheet.
**Left behind:**

**Closed out (orchestrated): Wave 48 is `done`; no Wave 49 is authored.**

- **Changed (master `09b315e9`, deploy green and the served bundle carried the headline before the shoot):** Log text and buttons fold onto 11/13/15 (`Text size xs` to `sm`, `compact-xs` to `compact-sm`, set-type label to `--vx-text-sm`); the all-stale headline reads `Last scored e1RM shown, none in 28 d` (tests updated); log/timer/recent now captured at 390 by also shooting `/strength-tracker?tab=train`. `make check` green (609 tests).
- **Verdict (`w48-strength`, fresh reviewer, 0 failed): fail, 59** - only `strength-log` fails, on a new P1 Communication: the "Fill from" chip prints bare numbers with no kg. The w47 font-size P1 is closed. Not fixed: the stray dot at 390 (a "▸" in an unlabelled first column of the scan; source not located); the H1 is still P2 (no as-of date, 28 d figures beside it). Detail: `docs/design/strength-tracker.md` § Wave 48.
- **Not verified:** no `detect.json`, no Keel read, collapsed diagnostics/alignment bodies never shot. Shots in `apps/dashboard/.design-shots/w48-strength` (gitignored); auth seeded via env from `secrets-run`, never printed or written. No background task left.

## Wave 49 — Strength: converge on the union of two reviews <!-- status: active -->

Strength's single-reviewer verdicts swing (68 → 19 → 83 → 59) because each fresh reviewer surfaces a different real item. To
converge instead of chasing one finding per wave: start from TWO independent fresh reviewers on the current live page (all
sheets, 1440 / 390, both schemes), take the UNION of their P0–P2 findings, fix them in one pass, then confirm with a THIRD fresh
reviewer. Known open: the "Fill from" chip prints bare numbers without `kg` (P1); the H1 has no as-of date beside 28 d figures
(P2); a stray `▸` in an unlabelled first column of the 390 scan (P3, locate the source).

- [ ] Two independent fresh reviews of the live Strength page; write the union of P0–P2 findings into
      `docs/design/strength-tracker.md` § Wave 49.
- [ ] Fix the union (argo items); a basalt cause becomes an `UPSTREAM.md` row, no workaround. Check/test green, deploy.
- [ ] A third fresh reviewer on the re-shoot. Pass = no P0/P1 and every component passes.
**Left behind:**

# Part 1, continued

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
