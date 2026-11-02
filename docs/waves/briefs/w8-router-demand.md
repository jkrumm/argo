Branch: feat/usage-v7-router-demand
Title: feat(usage): GET /usage/router and /usage/demand, split by lane
Owned files:
- apps/api/src/routes/usage-router.ts (new), apps/api/src/routes/usage.router.test.ts (new)
- apps/api/src/routes/usage-demand.ts (new), apps/api/src/routes/usage.demand.test.ts (new)
- apps/api/src/routes/usage-split.ts, apps/api/src/lib/usage-split.ts and their tests (`by=lane` only)
- apps/api/src/routes/usage.ts: only the imports and `.use(...)` lines for your two routes, beside `.use(usageCreditsRoutes)`
- apps/api/src/test/usage-seed.ts: additive helpers only (seeding gateway rows with lane_detail, gateway picks) if the existing ones lack them

Task:
Argo (`~/SourceRoot/argo`; read AGENTS.md, apps/api/AGENTS.md §Usage page data incl. §Credits, apps/api/.claude/rules/*.md)
is building the usage page v7. The signed spec is `docs/design/usage-tracking.md` (v7): read §Mental model, §Questions
(R1–R3, D1–D3), §Endpoints and §Data gaps 4–7 in full. You build the Router and Demand endpoints.

Data facts (live, today): gateway rows are `usage.records` with `source='gateway'`, `billing` `api_credit` (with
`account` = pool) or `api_key` (IU passthrough, `api_key='personal'`), `lane_detail` like
`{"pool":"iu","step":"synthesis","caller":"agw-opencode","run_id":…,"purpose":"prod","session":…,"fallback":null,"workflow":"review"}`
plus `costEstimated`/`costEstimatedUsd` on estimates. `usage.gateway_picks (ts, caller, session, picked, reason, machine,
request_id)`: picked is a pool id, `iu-api` or `refused`; reasons today `bound`, `soonest-expiry`, `claude-code`,
`forced`, also `no-pool`, `drained-retry`, `eval-reserve`, `eval-forced`, `eval-claude-code`. `request_id` = the gateway
row's `source_id`. The projection `USAGE_ROWS` (`src/lib/usage-source.ts`) carries `lane_detail`; prefer it, and read the
raw tables only where it lacks a field. agw's own media rows are `source='agent-workflows'` (the `x-agw-usage: caller`
exception). Two `lane_detail` fields land soon from agent-workflows: `origin` (who asked agw: `claude-code`, `hermes`,
`iris`, `macwhisper`, `cli`, …) and `routeFallback` (the refused request id when a GPT call replaced a refused Claude
call). Read both when present. Live rows can be read read-only for realistic fixtures:
`secrets-run run --env-file=apps/api/.env.test.tpl -- sh -c 'PGPASSWORD=$ARGO_TEST_PG_PASSWORD psql -X -h localhost -U $ARGO_TEST_PG_USER -d shared -f <file.sql>'`. SELECT only.

1. `GET /usage/router?range` (`usage-router.ts`), shape exactly as §Endpoints:
   - `picks`: per UTC day, target (pool id | `iu-api` | `refused`), reason, count, from `gateway_picks`.
   - `iu`: per day and cause, usd and requests, over gateway rows billed `api_key`. Cause: a non-Anthropic row
     (model not a Claude model; decide from the model, since the row has no path, and document the rule in the
     route's description) is `design`, or `eval` when purpose is eval; an Anthropic row takes its pick reason
     (`claude-code` → `claude-code`, `forced` → `forced`, `no-pool`/`drained-retry` → `credit-fallback`); a row with
     `lane_detail.routeFallback` is `route-fallback`. Add a top-level `routeFallbackMeasured: boolean` (true once any row
     in the store carries `routeFallback`) so the view can say "not measured yet".
   - `cache`: per caller × target, requests and hit rate (cache-read ÷ (fresh input + cache-read + cache-write), null
     with no input), over gateway rows.
2. `GET /usage/demand?range&by=workflow|step|model|origin|caller|repo&workflow&purpose[]&payer[]` (`usage-demand.ts`),
   shape exactly as §Endpoints. Reads gateway rows plus `source='agent-workflows'` media rows, never both for one call
   (Gap 6: on 2026-11-02 agw also wrote 383 `agent-workflows` rows, $5.01 since 08:10 UTC, for steps the gateway already
   recorded; `usage.records_unique` does NOT drop them (checked live: 0 of 383 dropped). agw stopped writing them
   (agent-workflows `d7a0034`), but the stored ones stay. Rule: an `agent-workflows` row is left out when a gateway row
   exists with the same run id (`lane_detail.run_id` on both, or however the agw row stores its run; check live) and the
   same model. Media rows (images, audio, Gemini, Replicate) have no such gateway twin and stay. Prove it on the live
   rows in your report: how many of the 383 the rule drops and their $), and add a test that a duplicate pair counts once. `byPurpose` buckets `prod`/`eval`/`verify`/`other` (`drift` and absent → `other`; absent
   purpose on a gateway row is `prod` only if the existing code says so, else `other`; say which in the description).
   `byPayer` keys are the existing payer values (`iu-credit`, `me-credit`, `iu-api`, …; see `payer` in the query layer).
   `runs` = distinct `lane_detail.run_id`. `by=origin` groups on `lane_detail.origin`, absent reads `(unknown)`.
   `by=caller` groups on `lane_detail.caller`. Athena team rows (`iu_key='athena-team'`) are never in demand.
3. `/usage/split?by=lane` (Gap 7): `lane` as a split dimension (D3), list value and fresh tokens per account as the other
   dimensions already work. Additive.
4. Every table read is guarded like `usage-credits.ts` guards its reads; empty shape, never 404/500. Do NOT import from
   `usage-credits.ts` or `usage-credits-math.ts` (deleted later in this wave); copy helpers you need. zod + `.describe()`
   on every field (apps/api/.claude/rules/openapi.md).
5. Tests: route tests against the scratch DB seeded through `src/test/usage-seed.ts` (see existing `usage.*.test.ts`):
   cause mapping per reason, refused picks, the cache rate, demand grouping per `by`, purpose and payer filters, the
   Gap-6 duplicate counted once, absent tables, the Athena exclusion. Pass criterion 3 of the spec: router's IU total
   equals the gateway's `api_key` rows over the range.

Validation: `bun run test:api -- src/routes/usage.router.test.ts src/routes/usage.demand.test.ts src/routes/usage.split.test.ts src/lib/usage-split.test.ts`
and `bun --cwd apps/api typecheck` and `bun run lint` and `bun run format:check`.
Finish: commit, push the branch (`git push -u origin feat/usage-v7-router-demand`), open a ready (not draft) PR (GitHub).
Report the PR URL, the validation output verbatim, and the router/demand totals over the live 7 d (one SELECT each that
mirrors your query) so the lead can check them.
Never touch files outside "Owned files". If the task needs one, stop and say which file and why. No dev servers.
