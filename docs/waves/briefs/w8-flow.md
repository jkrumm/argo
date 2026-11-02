Branch: feat/usage-v7-flow
Title: feat(usage): the v7 Flow tab (verdict, pace chart, supply/router/demand), v6 tabs and /usage/credits deleted
Owned files:
- apps/dashboard/src/routes/usage-tracking.tsx
- apps/dashboard/src/lib/window-stores.ts (the usage store only) and its test if any
- apps/dashboard/src/lib/queries/usage.ts
- apps/dashboard/src/features/usage-tracking/** EXCEPT explore-tab.tsx, subscription-detail.tsx, iu-key-detail.tsx and
  any new `explore-*` / `subscription-*` / `iu-key-*` files, AND EXCEPT the v6 parts the other worker reuses and may
  edit: over-time*, split-lists, split-model*, ranked-list, rhythm, heat-model*, weekly-volume, weekly-quota,
  quota-model*, compared, value-model*, routing*, pick-options, limits, budget-model*, reconciliation,
  reconcile-model*, top-spenders, cache-efficiency, period-model*, change-badge. You may import any of them unchanged
  and the three seam components; never edit them. Put your own work in new files (`flow-*`, `pace-*`, `node-*`, …)
- deleting: apps/dashboard/src/features/usage-tracking/{credits-tab,credits-model,credits-model.test,credits-boundary,credit-queries}.*
  and whatever else only the Credits tab used; apps/api/src/routes/usage-credits.ts, usage-credits-math.ts,
  usage.credits.test.ts, apps/api/src/lib/usage-credits.test.ts, their `.use(...)`/import in apps/api/src/routes/usage.ts
- AGENTS.md (the Usage Tracking paragraph), apps/api/AGENTS.md (§Usage page data, §Credits rewritten for v7),
  DESIGN.md (the payer table gains the credit rows, spec §Vocabulary)

Task:
Argo (`~/SourceRoot/argo`; read AGENTS.md, DESIGN.md, `.claude/rules/basalt-*.md` (law), `~/.claude/rules/frontend-routing.md`
(basalt-ui 2.x row), and the installed basalt-ui `llms.txt` before guessing an import; use `/basalt-design` and
`/basalt-charts` for the build and screenshot rounds). The signed spec is `docs/design/usage-tracking.md` v7: read it
all. Mocks: `docs/design/usage-v7/flow-{light,dark,mobile-light,mobile-dark}.png` and `flow.html` (look at the PNGs).

Build the **Flow** tab, the default of two tabs, Flow and Explore:
1. Route + store: tabs `flow` (default) and `explore`. Old stored/URL values (`overview`, `claude`, `iu-api`, `credits`,
   `iu-sub`, `me-sub`) migrate to `flow` (claude/iu-api/iu-sub/me-sub select their node: `sub:<account>`,
   `key:<iuKey>`; credits selects `pool:iu`). A `node` search field (`pool:iu|me|me2`, `sub:<account>`,
   `key:personal`, `router`, `demand:<workflow>`, none). A `payer` multi field for Explore (default empty). Keep
   `routingRange` (the subscription detail uses it), `lens`, `grain`, `groupBy`, `workspace`, `range` (default becomes
   7d per spec §Controls). Drop `account`, `iuKey` fields. Controls per spec: Range on both tabs; Measure, Grain,
   Workspace, Payer only on Explore. Render `<ExploreTab range grain lens groupBy workspace payer />` from
   `features/usage-tracking/explore-tab.tsx` for Explore (another worker fills it; it is a stub returning null today).
2. Flow per spec §Page structure › Flow, matching the mocks: (1) the verdict band: one sentence (verdict + the IU
   clause, the pace states of §Vocabulary, `thin` marked), a facts strip, the pace chart (credit left per pool on a
   calendar axis: actual solid in the pool's shade, even pace thin neutral, projection at R dashed, dry markers,
   expiry rules, the IU spill as a warn band) — compose `CartesianChart` per the basalt-charts rule;
   (2) an Insights slot under the verdict (see 5); (3) three columns of node cards, Supply / Router / Demand, as the
   spec's table lists them, joined by a thin chevron rule; (4) the selected node's detail at full width below
   (`?node=`): Pool detail, Router detail, Workflow detail per the spec's node table are yours; for `sub:*` render
   `<SubscriptionDetail account range />` and for `key:*` `<IuKeyDetail iuKey range />` (stubs today, another worker
   fills them); (5) Athena apart below a divider: the team key's cap, its spend by producer, "agw on this key since the
   cutover". Mobile 390: one column, a tapped node's detail directly under it, the pace chart full height.
   Pass criteria §(v7) 1, 4, 5 are yours: verdict, credit left and IU clause visible without scrolling at 1440 and 390;
   every node's numbers equal its detail's totals for the same range; Athena never in any total.
3. Data: `/usage/pace`, `/usage/router`, `/usage/demand` (`by=workflow`, `by=step&workflow=`, `by=origin`),
   `/usage/split?by=lane`, `/usage/quota-latest`, `/usage/iu-budget?iuKey=` are on master (read their zod schemas;
   `router.picksAvailable` and `routeFallbackMeasured` drive the "not measured yet" / unverified notes). Empty and
   stale states per spec §Empty and stale.
4. Delete, not hide: the Overview, Claude Max, IU API and Credits tabs and every file only they used that the other
   worker does not take over. The other worker builds Explore, SubscriptionDetail and IuKeyDetail out of v6 parts
   (over-time, split-lists, ranked-list, rhythm, weekly-volume, weekly-quota, compared, routing*, limits,
   reconciliation, top-spenders, cache-efficiency and their models): **do not delete those v6 parts**; delete
   overview.tsx, claude-tab.tsx, iu-api-tab.tsx, credits-*, credit-queries.ts, wallet-cards/wallet-figures/wallet-model
   (if only Overview used them) and the API `/usage/credits/*` (files listed above). The lead runs a dead-code pass after
   both changes land.
5. Insights: `/usage/insights` is being built in parallel. Build everything else first. When the lead tells you (rd
   say) it is on master, `git fetch && git rebase origin/master`, then render the strip: 3–5 ranked sentences, each
   linking to its node (`?node=`), thin marked, "nothing stands out" when empty. Its shape: `{ asOf, period, items: {
   id, rank, node, sentence, facts, usdMoved, thin }[] }`. If you finish before that note, report done-except-insights
   and stay at the prompt.
6. Docs in the same change: AGENTS.md's Usage Tracking paragraph and apps/api/AGENTS.md §Usage page data describe v7
   (two tabs, the endpoints, `/usage/credits/*` gone); DESIGN.md's payer table gains the credit rows.
7. Tests: the models you write (verdict sentence, money formatting, node totals, search migration) in the existing
   `*.test.ts` style under `bun --cwd apps/dashboard test`. Shots: run `/basalt-design`'s `basalt-ui shot` rounds and
   the `basalt-design-reviewer` subagent on your Flow at 1440 and 390, light and dark, against the mocks; fix what it
   flags. Never start a dev server for Argo itself (the shot tool runs its own build, per its skill).

Validation: `make check` (the whole thing, it is the merge gate) and
`bun run test:api -- src/routes/usage.pace.test.ts src/routes/usage.router.test.ts src/routes/usage.demand.test.ts`.
Finish: commit per concern, push the branch (`git push -u origin feat/usage-v7-flow`), open a ready (not draft) PR
(GitHub). Report the PR URL, the validation output verbatim, the shot paths and the reviewer's verdict.
Never touch files outside "Owned files". If the task needs one, stop and say which file and why.
