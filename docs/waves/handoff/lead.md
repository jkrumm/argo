# Wave 8 lead (argo) — handoff

Lead of argo Wave 8 (usage view v7), mother `agent-workflows-w1-r4`. agw Wave 8 runs beside it under lead
`agent-workflows-w1-r11` (t86) in the agent-workflows main checkout: never edit there.

## Phases

1. API + agw (parallel): `feat/usage-v7-pace` (briefs/w8-pace.md, Opus), `feat/usage-v7-router-demand`
   (briefs/w8-router-demand.md, Sonnet), agent-workflows `feat/gateway-origin-route-fallback`
   (briefs/w8-agw-origin-fallback.md, Sonnet).
2. After 1 lands: `/usage/insights` API; the Flow + Explore views, v6 tabs and `/usage/credits/*` deleted, docs.
3. Deploy argo (`make deploy`, `make verify`), agw deploy after r11's OK, `@verifier` shots light/dark 1440/390.

## State

- Phase 1 spawned 2026-11-02.
- r11 (2026-11-02): agw double rows fixed from release 2f657c0 (~17:00 UTC). The 383 rows of 11-02 (and Wave 3's 34) stay
  counted in `records_unique`, owner's call: no upstream marking. `/usage/demand`'s twin drop is the only correction;
  the IU personal tracked figure keeps the $5.01 of 11-02 (Left behind). r11's workers touch capabilities/index.ts,
  package.json, host review/scorer.ts + module.ts, packages/eval: rebase the agw branch onto master before training.
- Merged to argo master: #213 pace (bed3de9a), #212 router/demand (4cea990f), #214 explore + details (e2ac8c8b).
  Train check: `(make check || make check) && bun run test:api` (astro-visibility flakes at load ~30+).
- Running: feat/usage-v7-flow (t8w), feat/usage-v7-insights (t8x), agw #114 (t8n; sent back to wire model-call.ts
  and the prose/podcast fallbacks). Flow told to rebase on #214 before deleting v6 files.
- agw #114 merged (agw master f5b3df1 after rebase), deployed with r12's OK: release f5b3df101f57, gateway build
  d306b78a29d319c2, `make verify` PASS; fresh gateway rows carry `lane_detail.origin` (claude-code). r12 notified.
- All argo code merged: #215 insights, #216 flow (v6 tabs + /usage/credits deleted), #217 API polish (Athena guard,
  lastRequestAt + stale note, credit-payer tests). Lead commits: 9d63c90b (unit tests 30 s), 37e3cd45 (traced-fetch
  test 10x timings), 08420e6d (dead ranked-list). Deployed 316ef3c8: make verify PASS, verify-pages PASS 14 routes.
  Criterion 2 iu $2.06 / me $2.00; criterion 3 router IU $7.5346 = SQL. @verifier running shots + criteria 1, 4, 5.
- DONE 2026-11-02: #218 UI polish merged, argo release 6702133977ad live, @verifier round 2 PASS on all seven fixes and
  criteria 1 and 5. Close-out in PLAN.md Wave 8 (status done). No worker or worktree left.
