# Usage, rebuilt — one page that tells the truth about the two subscriptions and the IU API
**Goal:** Argo's `/usage-tracking` answers three questions at a glance, then lets Johannes drill in: (1) am I
inside the IU API's rolling 30-day $500 cap, and what can I spend today; (2) how much headroom do the two Claude
Max subscriptions (`iu` 20x, `me` 5x) have this week, and are the pickers routing well; (3) where do
dollars **and tokens** actually go: which tool, sub-tool, model and project, with cache vs fresh input vs output
split, and how that moves over time. Tinycast stays the glanceable face and the page is the analysis face.
They use the same vocabulary and numbers.
**Gate:** `make check` green; each UI wave proves itself with the repo's evidence/screenshot command against
real data (light + dark), plus a basalt design review (`basalt-design-reviewer`). Deploy is the orchestrator's call.
Previous plan (basalt-ui 2.0 migration, Waves 1–10) is done; see git history of this file.

## Established — do not re-derive (orchestrator, 2026-10-26)

- **The IU cap's truth is IU's portal, not our estimate.** usage-tracker scrapes the self-service cost portal
  every 4 h (headless Chrome on the MacBook). It stores `iu_portal_cost(day,label,row,model,cost_usd)` and
  `iu_portal_total` in its SQLite (`~/.local/share/usage-tracker/usage.db` on the mini), and writes
  `~/.local/share/iu-portal/latest.json` on the MacBook for Tinycast (schema 1: `rolling30_usd`,
  `can_spend_today_usd`, `daily[]`, `top_models[]`, `dropoff_next7[]`, `limit_usd` 500, `window_days` 30).
  **None of this reaches Argo yet.** usage-tracker's `make budget` is the reference output: rolling-30 vs cap,
  can-spend-today, drop-off of the next 7 days, a 7-day burn projection, and portal-vs-tracked per day and per model.
  On 2026-10-26 the window stood at $573 / $500.
- **Where the IU money goes (usage-tracker, 30 d, billing=iu):** agent-gateway's review dominates.
  `review_ocr` (alibaba open-code-review CLI on deepseek-v4.1-flash, 3.5 B cache-read tokens) $197,
  `review:adversary` on gpt-5.6-terra $86, `review:angle` on haiku-5.5-eu $48, then research-gateway worker
  $48, the claude-code `agent-gateway:check` lane $33, opencode interactive/review/dispatch ~$15 each, and the
  audio-gateway podcast writer $28. This is exactly the analysis the page must make obvious without SQL.
- Tokens matter as much as dollars. Cache-read volume (billions) vs fresh input vs output explains cost: a
  cheap model with huge cache reads can out-spend an expensive one.
- Existing page: `apps/dashboard/src/routes/usage-tracking.tsx` + `apps/dashboard/src/features/usage-tracking/*`
  (~1.5k lines: cost/tokens/quota/folded charts, claude-accounts, picks-panel, top-projects, usage-strip,
  health-card, page-headline). Design doc `docs/design/usage-tracking.md`. API: `/usage/*` (records with
  `account`, `payer` = `iu-sub|me-sub|iu-api|me-api|unknown`, quota-samples, account-picks). basalt-ui 2.27,
  TanStack Charts. The basalt rules/skills are the authority (`.claude/rules/basalt-*.md`,
  `basalt-design` / `basalt-charts` / `basalt-app` skills).
- Tinycast (`~/SourceRoot/tinycast-extensions`, MacBook): the Claude usage menu bar/Detail/hub now carry the IU
  budget (`extension/src/usage/iu-budget.ts`) next to the two-account quota and routing views. Reuse its
  state words (ok / warn ≥ 80 % / over), its freshness rules (stale > 8 h, dead > 48 h) and its "can spend
  today / frees over 7 days" framing, so both surfaces read alike.

## Wave 1 — Audit and design spec (no product code)            <!-- status: done -->
- [x] Audit the current page against live data (light + dark) and Tinycast's vocabulary.
- [x] Query usage-tracker's DB read-only and Argo's `/usage/*`; gaps listed in the spec.
- [x] Write `docs/design/usage-tracking.md` v2 (top band, lens, sections A–G, contracts, states).
- [x] Specify the data work (portal sync, aggregate endpoints) in Wave 2; UI in Wave 3.
- [x] Commit the spec and the expanded plan; stop for the owner's review of the spec.
**Left behind:** Spec at `docs/design/usage-tracking.md`; audit findings are its first table. Decisions the owner should
confirm or veto before Wave 2: (1) **Max rows are "list value", never "cost"/"spend"**; the page's default scope is IU API
spend ($627 of the $19,136 the old headline shows). (2) Tokens lens shows cache-read as its own series and never adds it to
fresh tokens (old `tokens` metric drops it: 47.8 B read vs 0.38 B output in 30 d). (3) Flow view ships as a shipped
`Heatmap` (sub_tool x model); basalt has no Sankey, a ribbon flow is a stretch only if the review rejects the Heatmap.
(4) v1 strip, payer bar, 30 d quota line, picks-per-day bars, call-count headline are cut; p95/errors move to a collapsed
section G. (5) Gaps found: tracked vs portal drifts up to 0.42x-2.72x per day (2026-10-22: $71 vs $30), 1,631 unpriced IU
rows in 30 d; quota/pick history only since 2026-10-24. `make evidence` timed out in its Lighthouse lane at 500 s
(screens lane finished); the audit used `make design-shot ROUTES=/usage-tracking`. No product code changed.

## Wave 2 — Data: portal sync + aggregate endpoints            <!-- status: done -->
Repos: `argo` (apps/api) and `~/SourceRoot/usage-tracker`. Contracts are in the spec's "Data work" section; do not re-derive.
- [x] Argo migration 0026 + drizzle schema for `iu_portal_cost` / `iu_portal_total`; `POST /usage/iu-portal` (upsert, `rejected` count, 1000-row cap) with route tests (replay is a no-op, overwrite on re-post, invalid rows dropped).
- [x] usage-tracker `src/sync-portal.ts`: watermark in `collector_state`, resend last 35 days when `fetched_at` moved, `tolerateMissing`, wired into the 15 min sync; unit tests with a fake `postJson`. Commit in usage-tracker (direct to master unless it is PR-required), deploy via its Makefile, verify first push lands 235 rows in Argo.
- [x] `GET /usage/iu-budget` (pure budget functions ported from `budget.ts`, same numbers as `make budget`) and `GET /usage/iu-reconcile`; tests with the 2026-10-26 fixture (rolling30 $573, can-spend -$65.59).
- [x] `GET /usage/flow` (rows per source x sub_tool x model; feeds B and C) and `GET /usage/movers`; extend `GET /usage/timeseries` with `tokens_input|output|cache_read|cache_write` metrics and `top=N` server-side fold; existing `tokens`/`cost` shapes unchanged (Tinycast reads them); tests.
- [x] Verify against production after deploy (orchestrator's call): `iu-budget` equals `make budget`, `flow` top cell is `review_ocr` x deepseek-v4.1-flash, response sizes < 60 kB, warm < 1 s. Update `AGENTS.md` API section in the same commit. Gate: `make check`.
**Left behind:** Commits: argo `7960f247` + review-fix commit (migration 0026, `POST /usage/iu-portal`, `GET /usage/{iu-budget,iu-reconcile,flow,movers}`, timeseries `tokens_input|output|cache_read|cache_write` + `top=N`, AGENTS.md in `apps/api` and root); usage-tracker `495db16` on master, **already deployed** (`make deploy`, verified loaded). Gate: `make check` green (1730 + 636 tests); the 79 `src/routes/usage*` integration tests passed against a throwaway local Postgres (not in `make check`).
- **Orchestrator to do after deploying Argo:** (1) the tracker's next 15 min sync pushes the portal rows (watermark `argo_portal_fetched_at`; 404 until Argo ships, nothing lost) — confirm `iu_portal_cost` holds ~249 rows (235 in the plan, the report has grown); (2) verify `GET /usage/iu-budget` equals `make budget` in usage-tracker (rolling30 $588.14 / can-spend −$65.59 / projected7 $697.45 at the 2026-10-26 fetch); (3) `flow` top cell `review_ocr` × `deepseek-v4.1-flash` (`payer=iu-api`), sizes < 60 kB, warm < 1 s. Not verifiable from here: no prod access to Argo.
- **Contract decisions for Wave 3:** `flow` takes `top` (default 200, not 12): the client slices the ranked list itself and derives C from all rows; the tail folds into one `other` row. Tokens lens ranks by all classes incl. cache-read (that is what puts `review_ocr` first). `iu-reconcile` models keep their own label when one side is missing (no `(unmatched)` bucket), days are clamped to the first portal day (no false flags before coverage), newest day `partial: true`. `iu-budget` returns zeros + `fetchedAt: null` when empty: the page must treat null as "No portal data yet", never as full headroom; freshness words (fresh/stale/dead) are computed client-side from `fetchedAt`. Portal upserts only move forward in `fetchedAt`.
- **Prod verified (orchestrator, 2026-10-26, commit cd03f569):** `iu-budget` = `make budget` ($588.14 / −$65.59 / projected7 $697.45); `flow` top row `review_ocr` × `deepseek-v4.1-flash`; sizes flow 40 kB, reconcile 7 kB, budget 2 kB; warm flow 0.42 s, others < 0.35 s. Owner approved the spec decisions 2026-10-26 (flow view = the ranked list in the current spec).
- `/usage/headline` untouched (removal is after the page ships). Review (agent-gateway): 1 blocking (out-of-order overwrite) fixed; fail-open-on-empty and server-side `stale` flag deliberately skipped (page owns freshness); the repo-layer extraction suggestion skipped as out of scope.

## Wave 3 — The page            <!-- status: done -->
Replaces the v1 page per the spec; reads only the Wave 2 endpoints (+ `/usage/quota`, `/usage/account-picks/summary`). Read `.claude/rules/basalt-*.md` and use the `basalt-design` skill; every round is `make design-shot ROUTES=/usage-tracking` scored by a fresh `basalt-design-reviewer`.
- [x] Data layer: query options + typed models for the new endpoints, lens/scope state in `usageStore`, pure model functions (pace tick, state words, freshness, delta glyphs) with tests; delete the v1 model code the new page does not use.
- [x] Top band: Q1 cap gauge + drop-off bars, Q2 subscription meters with pace tick, Q3 movers; all states from the spec (fresh/stale/dead/empty/over).
- [x] Lens bar + sections A (stacked area + ranked list), B (ranked top spenders, tool · model), C (cache efficiency), E (projects).
- [x] Section D reconciliation, collapsed F routing and G reliability; remove the cut v1 components and CSS.
- [x] Shot rounds light + dark, desktop + mobile, until the reviewer passes; record rounds in the spec. Check the spec's pass criteria 1-7 against live data. Update AGENTS.md and the design doc. Gate: `make check`. Deploy is the orchestrator's call.
**Left behind:** Commits `a4544969` (API `GET /usage/quota-latest`), `835829cd` (page rebuild), `03bc1c7f` (docs + spec build record). Gate: `make check` green (636 API tests; dashboard 494). Code review (agent-gateway): clean, 5 optional improvements, one taken (picks-panel dead clause); skipped: routing/subscription silent-failure notes, `quota-latest` DISTINCT ON → per-account LIMIT 1 (fine at ~73k rows/yr), picks-panel → routing rename.
- **Deploy order matters:** the page calls `/usage/quota-latest` and `/usage/iu-budget`; deploy API + dashboard together. Until then Subscriptions shows its error state (prod 404). `/usage/headline` API route is still live and now unread by the dashboard; removal is a follow-up.
- **Design review did not reach a clean pass.** Shot rounds r1–r6 are in `docs/design/usage-tracking.md` §Build record (best 63 at r4, 24 at r6; the reviewer keeps surfacing new P1/P2 copy/layout items). Residuals are listed there. Pass criterion 7 (`basalt-design-reviewer` pass) is therefore NOT met; page-level verdict was pass in r4–r6, component fails remain. `make design-shot` produces no metrics/sheets: score with `basalt-ui shot /usage-tracking --base <evidence-server origin>` (recipe: serve `apps/dashboard/dist` via `scripts/evidence/server.ts`).
- **Not verified against live data:** Q2 loaded state, Tokens lens, expanded F/G, D's 2026-10-22 flag (read from code/tests only), criteria 2 and 4 by eye. Re-shoot after deploy.
- Deviations from the spec are in the same Build record section (lens as PageBar tab, scope as SelectFilter, C vertical bars, no click-through on B/D).


## Wave 4 — Concise page: how much we build, where it goes, where the limits are            <!-- status: done -->
**Owner verdict on Wave 3 (2026-10-26):** the v2 page is too IU-API-centric and too deep. The v1 page (last at `63487b7a`) showed his actual building better. He wants: $ usage and token usage back across everything, the projects worked on most, the tools spent on most, where the API tokens go (compact, not extensive), and where we are on the limits — one concise, self-explanatory view. "Relax and cut it down."
**Decisions (orchestrator, overriding Wave 1 decision 1 and the IU-first layout):**
- Default scope is **all payers** (Max list value + IU API), not IU API. Max stays labelled "list value"; IU is "spend". The scope filter stays but is secondary.
- Spend and tokens are equally first-class. Keep the lens toggle, or show both side by side where that is clearer.
- Target layout, top to bottom (at most 5 visible blocks; everything else collapsed or gone):
  1. **Limits** — one compact row: Max `me` 7 d, Max `iu` 7 d, IU API rolling 30 d cap. Each is a single meter with a pace tick, % and reset/headroom in one line. No drop-off bars, no burn paragraph, no "leaving the window" text.
  2. **Headline** — total $ and total tokens for the range, with the delta vs the prior period (v1's headline strength).
  3. **Over time** — one chart for $ or tokens per day, stacked by payer/source (v1's cost and tokens charts merged).
  4. **Projects** and **Tools** side by side — the projects worked on most, the tools spent on most; $ and tokens per row, with a delta glyph instead of a separate Movers card. Projects is prominent, not at the bottom.
  5. **IU API detail** — collapsed by default: where the API tokens go (top tool·model pairs), cache efficiency, portal-vs-tracked reconciliation. Compact versions only.
- Cut: the Movers card (folded into the delta glyphs), drop-off bars, the per-model reconciliation table (keep the day strip + totals), the Routing section, Reliability unless it fits in one collapsed line. The sidebar "Spend by tool" duplicate goes.
Steps:
- [x] Before/after: shoot the v1 page (build `63487b7a` in a throwaway `git worktree` under /tmp, serve it with the evidence-server recipe from Wave 3's Left behind) and the current v2 page, light + dark, desktop + 390 px. Write a short keep/cut table into the spec (which v1 and v2 pieces survive and why). Remove the worktree after.
- [x] Load the `basalt-design` + `basalt-charts` skills and the user-level `dataviz` skill; pick a chart form per block from them (no new chart kinds basalt does not ship).
- [x] Rebuild the page to the target layout; reuse the Wave 2 endpoints and existing models; delete components and CSS the new layout drops. Use the existing endpoints (`/usage/timeseries`, `/usage/flow`, `/usage/quota-latest`, `/usage/iu-budget`, `/usage/iu-reconcile`); add API work only if a block truly needs it.
- [x] Fix the Wave 3 verifier P2s if their components survive: portal $588 vs tracked $645 unlabelled; tool·model order (spec says tool · model) and the 390 px collision; "stale" marker too subtle.
- [x] At most 3 shot rounds (`basalt-ui shot` per the Wave 3 recipe) with a fresh `basalt-design-reviewer`; judge by the owner's brief above (concise, self-explanatory, the build volume first), not by chasing reviewer score. Update the spec and AGENTS.md. Gate: `make check`, then agent-gateway review. Commit and push; deploy (CI on push) is fine — the orchestrator verifies.
**Left behind:**
Commit: the page rebuild plus this plan update on master (CI deploys on push; the orchestrator verifies). Gate: `make check` green (1745 dashboard + 636 API tests; theme guard clean). Review (agent-gateway): 2 blocking fixed (a folded key read as a false `new`; Max list value ranked under a bare "spend" label), improvements taken: running day excluded from both windows, null-propagating Other row, per-meter error in Limits; skipped: payer-split extraction into a pure fn, `Section` lazy-mount check (verified: closed children do not mount).
- **Layout shipped:** Limits row, Headline (Spend + list value, Tokens; delta vs prior period), Over time (lens, group by payer/tool/model/source), Projects | Tools (bar = lens, muted other measure, delta glyph, Other as a text line), IU API detail collapsed (tool · model, cost per 1 M + cache-read %, portal vs tracked strip + totals). Default scope all payers, default grouping payer. Removed: Movers, drop-off, Routing, Reliability, token-class stack, cache bars, reconciliation table, `sourceScope`, palette groups billing/account/recon/token/outcome (also from DESIGN.md), dashboard `movers`/`pickSummary`/`breakdown` query options. API routes (`/usage/headline`, `movers`, `account-picks`, `breakdown`) are untouched and now unread by the dashboard.
- **Shots:** r1–r3 recorded in the spec's Build record with the keep/cut table; r3 reviewer 51, page pass. Residuals are listed there, none brief-breaking. Not re-shot after the last fixes: only a self-check of the Tools list.
- **Not verified against prod:** this wave ran against production data through the evidence proxy (read-only), so the numbers are live; the deployed page is the orchestrator's to confirm. Ranked lists request `timeseries` top=16 over up to 90 d (two metrics per list); payload sizes were not measured.
- **Follow-ups for the orchestrator:** the `/usage/headline` and `/usage/movers` API routes could go; decide whether a one-line reliability marker should come back.
