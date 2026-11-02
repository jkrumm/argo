Branch: feat/usage-v7-pace
Title: feat(usage): GET /usage/pace, the credit waterfall, and iu-budget underCapOn
Owned files:
- apps/api/src/lib/usage-pace.ts (new), apps/api/src/lib/usage-pace.test.ts (new)
- apps/api/src/routes/usage-pace.ts (new), apps/api/src/routes/usage.pace.test.ts (new)
- apps/api/src/routes/usage-portal.ts and apps/api/src/routes/usage.portal.test.ts (only the `underCapOn` addition and whatever shared helper `pace` needs from it)
- apps/api/src/routes/usage.ts: only the import and one `.use(usagePaceRoutes)` line beside `.use(usageCreditsRoutes)`
- apps/api/src/test/usage-seed.ts: additive helpers only (seeding gateway picks, credit cycles, platform cost, portal cost) if the existing ones lack them

Task:
Argo (`~/SourceRoot/argo`, read its AGENTS.md and apps/api/AGENTS.md §Usage page data, and apps/api/.claude/rules/*.md)
is building the usage page v7. The signed spec is `docs/design/usage-tracking.md` (v7): read §The headline, §Mental
model, §Questions (H, S1, S2, S4), §Pace model and §Endpoints in full. You build the API half of the verdict.

1. `apps/api/src/lib/usage-pace.ts`: pure functions, no DB, implementing §Pace model exactly:
   - spent per pool and cycle = Σ over the cycle's UTC days of max(metered_day, reported_day). metered_day sums
     `cost_usd`, else `lane_detail.costEstimatedUsd`, of the pool's gateway rows (`source='gateway'`,
     `billing='api_credit'`, `account=<pool>`); reported_day comes from `usage.platform_cost` (sum of `cost_usd` per
     account and day). `outsideUsd` = what the report holds beyond the meter on days the gateway did not carry (today:
     iu $56.11 on 31 Oct); `meteredUsd`, `reportedUsd` (null when the pool has no report), `reportedAt` (max `refreshed_at`).
   - left = grant − spent; required pace = left ÷ days left (fractional days to cycle end).
   - production rate R: credit-eligible Claude demand ÷ window. Rows: gateway rows with purpose (`lane_detail.purpose`)
     ≠ 'eval', billed to a pool (`api_credit`) or to IU by fallback (the row's `source_id` = `usage.gateway_picks.request_id`
     with `picked='iu-api'` and reason `no-pool` or `drained-retry`). Window = last 7×24 h clipped to the first gateway
     row (the cutover). `thin` when the window is under 24 h. E = the same over purpose = 'eval'.
   - the waterfall: enabled pools ordered by cycle end; the first draws R from now, dries at now + left÷R or expires with
     left − R×days unspent; the next starts drawing at that instant. A disabled pool is listed with its grant, draws nothing.
     `projection { drawsFrom, dryAt, unspentAtEndUsd }`.
   - spill: from the last pool's dry instant to the soonest renewal (the earliest current-cycle end among the enabled
     pools: iu's 21 Nov today), `days` and `claudeListUsd = R × days`. Null when nothing spills.
   - verdict: `over` when the last pool runs dry before the soonest renewal; `under` when any pool expires with more than
     max($5, 5 % of grant) unspent; else `on-pace`; `no-pool` when none is enabled.
   - eval reserve per pool = grant × daysLeft ÷ cycle length days; evalAvailable = max(0, left − headroom − reserve)
     with the gateway's $2 headroom (agent-workflows docs/gateway.md §Credit pacing defines it; you may read
     `~/SourceRoot/agent-workflows/docs/gateway.md`, never edit that checkout).
   - `days[]` per pool: `{ day, meteredUsd, reportedUsd, leftUsd }` over the cycle so far (the burn-down).
   - `previous`: the pool's previous cycle from `usage.credit_cycles` (reconciled and unspent).
2. `GET /usage/pace` in `apps/api/src/routes/usage-pace.ts`, the exact response shape of §Endpoints (zod, every field
   `.describe()`d per apps/api/.claude/rules/openapi.md). It is state, not ranged: no `range` param. Pools come from
   `usage.credit_cycles` (current cycle per account: the row whose start ≤ now < end) plus the registry facts the spec
   names (iu $200, me $100, me2 $100). A pool with no current cycle row is `enabled: false` with note `not enabled` (me2
   today: "not enabled: $100 a cycle, cycle unknown"). Decide the registry source: if the dashboard registry
   `apps/dashboard/src/features/usage-tracking/accounts.ts` already has grants, keep an API-side constant beside the
   route; do not import across apps. `claudeOnIuUsd` since the cutover = cost of gateway rows whose pick was `iu-api`
   with reason `claude-code`, `no-pool` or `drained-retry`, plus rows with `lane_detail.routeFallback` set (that field
   lands with agent-workflows' change; read it when present). `personalKey` from the same logic as
   `/usage/iu-budget?iuKey=personal`, including `underCapOn`.
   Every table read is guarded the way `usage-credits.ts` guards them (the table may be absent in a scratch DB): degrade
   to the decided empty shape, never 404/500. Do NOT import from `usage-credits.ts` or `usage-credits-math.ts`: both are
   deleted by a later change in this wave. Copy any helper you need into `lib/usage-pace.ts`.
3. `/usage/iu-budget` gains `underCapOn`: the first day the rolling 30-day sum drops under the cap, projecting each future
   day's spend at the last 7 days' mean; null when already under or never under within 60 days. Additive; existing fields
   unchanged.
4. Tests: `lib/usage-pace.test.ts` on fixtures of today's figures (the spec's §The headline table: iu left $88.43 of
   $200 ending 21 Nov, me $93.09 of $100 ending 27 Nov, $56.11 outside on 31 Oct, the report trailing the meter today;
   R ≈ $85/d gives iu dry 3 Nov and me dry 4 Nov, verdict `over`, and spill until 21 Nov). Cover `under`, `on-pace`,
   `no-pool`, `thin`, a disabled pool, an unknown cycle. Route test `routes/usage.pace.test.ts` against the scratch DB
   (seed via `src/test/usage-seed.ts`, the existing route tests show the pattern), incl. absent tables. Portal test for
   `underCapOn`.
   You may read the live rows read-only for realistic fixtures: `secrets-run run --env-file=apps/api/.env.test.tpl -- sh -c
   'PGPASSWORD=$ARGO_TEST_PG_PASSWORD psql -X -h localhost -U $ARGO_TEST_PG_USER -d shared -f <file.sql>'`. SELECT only.

Acceptance: `/usage/pace` returns the spec shape; on today's live rows its `leftUsd` per pool would match the gateway's
`creditLeftUsd` + $2 headroom within $0.50 (state the figures you see in your report); tests green; tsc green.

Validation: `bun run test:api -- src/lib/usage-pace.test.ts src/routes/usage.pace.test.ts src/routes/usage.portal.test.ts`
and `bun --cwd apps/api typecheck` and `bun run lint` and `bun run format:check`.
Finish: commit, push the branch (`git push -u origin feat/usage-v7-pace`), open a ready (not draft) PR (GitHub). Report
the PR URL and the validation output verbatim.
Never touch files outside "Owned files". If the task needs one, stop and say which file and why. No dev servers.
