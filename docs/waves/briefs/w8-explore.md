Branch: feat/usage-v7-explore
Title: feat(usage): the v7 Explore tab and the subscription and IU key details
Owned files:
- apps/dashboard/src/features/usage-tracking/explore-tab.tsx, subscription-detail.tsx, iu-key-detail.tsx (stubs on
  master today: replace their bodies, keep the exported props interfaces as they are)
- new files under apps/dashboard/src/features/usage-tracking/ named `explore-*`, `subscription-*`, `iu-key-*` (+ tests)
- the v6 parts you reuse, edited only as needed to take props instead of the old tab context: over-time*, split-lists,
  split-model*, ranked-list, rhythm, heat-model*, weekly-volume, weekly-quota, quota-model*, compared, value-model*,
  routing*, pick-options, limits, budget-model*, reconciliation, reconcile-model*, top-spenders, cache-efficiency,
  period-model*, change-badge
- NOT yours: apps/dashboard/src/routes/usage-tracking.tsx, apps/dashboard/src/lib/window-stores.ts,
  apps/dashboard/src/lib/queries/usage.ts, and every other usage-tracking file (another worker builds the Flow tab and
  deletes the v6 tabs in parallel). If you need a new query in queries/usage.ts, put it in an `explore-queries.ts` of
  your own instead.

Task:
Argo (`~/SourceRoot/argo`; read AGENTS.md, DESIGN.md, `.claude/rules/basalt-*.md` (law), `~/.claude/rules/frontend-routing.md`
(basalt-ui 2.x row), the installed basalt-ui `llms.txt` before guessing an import; `/basalt-design`, `/basalt-charts`).
The signed spec is `docs/design/usage-tracking.md` v7: read §Page structure (Flow's node table, Explore), §v6 → v7,
§Carried from v6. Mocks in `docs/design/usage-v7/` (Flow only; Explore has no mock: it is v6's blocks re-scoped).

1. **ExploreTab** (`explore-tab.tsx`, props `ExploreTabProps`): v6's analysis blocks across every payer at once,
   filtered by the `payer` prop (empty = all payers except Athena team; Athena team is off by default and never in an
   "all"): Over time (group by payer, tool, model, project via `groupBy`), Projects | Tools rows with their daily
   timelines, Rhythm, Weekly volume. Range, Measure (`lens`), Workspace, Grain as in v6. Look at how
   `claude-tab.tsx` / `iu-api-tab.tsx` / `overview.tsx` compose these today (they are deleted by the other worker,
   so copy what you need, do not import from them).
2. **SubscriptionDetail** (`subscription-detail.tsx`, `{ account, range }`): v6 Weekly quota sawtooth for that
   account, the Compared row (list value, value multiple, tokens, active days), and the account picker's Routing
   section with its own range from `usageStore.field.routingRange` (the store keeps that field; read it, do not edit
   the store). Tokens beside dollars per spec §Controls.
3. **IuKeyDetail** (`iu-key-detail.tsx`, `{ iuKey, range }`): cap meter, can spend today, the under-cap date
   (`/usage/iu-budget` now returns `underCapOn`), portal vs tracked (v6, one key, `gapReading` per key), top
   spenders and cost per 1 M (v6). One key at a time, never a sum. Empty: "No portal report for this key yet · the
   next portal sync fills the cap".
4. Tests for any model you add or change (`bun --cwd apps/dashboard test`). Until the Flow tab lands these
   components are not mounted, so prove them with `basalt-ui shot` the way `/basalt-design` describes if it can mount
   a component, else with model tests; the lead shoots the whole page after both changes land.

Validation: `bun --cwd apps/dashboard typecheck`, `bun --cwd apps/dashboard test`, `bun run lint`, `bun run format:check`.
Finish: commit, push the branch (`git push -u origin feat/usage-v7-explore`), open a ready (not draft) PR (GitHub).
Report the PR URL and the validation output verbatim, and list every v6 file you edited.
Never touch files outside "Owned files". If the task needs one, stop and say which file and why. No dev servers.
