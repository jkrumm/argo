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
