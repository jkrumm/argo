Branch: fix/usage-v7-api-polish
Title: fix(usage): keep Athena out of the pace, router lastRequestAt, credit-payer tests, stale credits mentions
Owned files:
- apps/api/src/routes/usage-pace.ts, apps/api/src/routes/usage.pace.test.ts
- apps/api/src/routes/usage-router.ts, apps/api/src/routes/usage.router.test.ts
- apps/api/src/lib/usage-query.ts (a comment only)
- apps/api/src/routes/usage.payer.test.ts
- apps/api/src/test/usage-seed.ts (additive helpers only)

Task:
Argo (`~/SourceRoot/argo`; AGENTS.md, apps/api/AGENTS.md, apps/api/.claude/rules/*.md). Usage page v7, spec
`docs/design/usage-tracking.md`. `/usage/pace`, `/usage/router`, `/usage/demand`, `/usage/insights` are on master (or
about to be); `/usage/credits/*` is being deleted by another change (PR #216) together with
`usage.credits.test.ts`. Fixes from the review of that change:

1. **Athena out of the pace (blocking).** `usage-pace.ts`: `readClaudeOnIu`'s `routeFallback` branch has no billing or
   key filter, and `iuPickWithReason` and `readDemand`'s eligible predicate lack the Athena guard. Every IU branch must
   be `billing = 'iu' AND iu_key IS DISTINCT FROM 'athena-team'`, as `usage-router.ts` and `usage-demand.ts` already do.
   Route test: an athena-team gateway row with a `routeFallback` marker and one with a `no-pool` pick count in neither
   `claudeOnIuUsd` nor the production rate. Spec pass criterion 5: Athena never in any total.
2. **`lastRequestAt`** on `/usage/router`: ISO of the newest gateway row (any range; null when none), described as
   the input to the spec's stale state ("last row older than 30 min: last request {age} ago", §Empty and stale).
   Additive. Test.
3. **Credit-payer DB tests.** The deleted `usage.credits.test.ts` held the only DB-backed tests of the credit payers;
   move the equivalent cases into `usage.payer.test.ts`: `iu-credit`/`me-credit`/`me2-credit` in the payer breakdown,
   the `billing=api_credit` filter total, the payer filter and split totals over seeded gateway rows. Read
   `git show origin/master:apps/api/src/routes/usage.credits.test.ts` (or the commit before #216 lands) for what they
   covered; keep only what is about payers, not the deleted endpoints.
4. **Stale mentions.** `usage-router.ts` and `usage-pace.ts` OpenAPI descriptions and a comment in
   `lib/usage-query.ts` still name `/usage/credits/*`; point them at `/usage/pace` / `/usage/router`.

Validation: `bun run test:api -- --timeout 30000 src/routes/usage.pace.test.ts src/routes/usage.router.test.ts src/routes/usage.payer.test.ts`
and `bun --cwd apps/api typecheck` and `bun run lint` and `bun run format:check`. The machine is loaded (load avg
50-100); a 5 s timeout in an unrelated test is not yours.
Finish: commit, push the branch (`git push -u origin fix/usage-v7-api-polish`), open a ready (not draft) PR (GitHub).
Report the PR URL and the validation output verbatim.
Never touch files outside "Owned files". If the task needs one, stop and say which file and why. No dev servers.
