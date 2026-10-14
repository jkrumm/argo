# argo on basalt-ui 2.0

**Goal:** argo's dashboard runs on `basalt-ui@2.x` in production: every chart on the 2.x kinds, the
shell, routing, tables and AI chat on the 2.0 contracts, SSR-first with streamed sections, and no
workaround for basalt anywhere in argo. Proven against argo's recorded baseline with screenshots,
render and bundle numbers, and OTel traces.

**Gate (every wave):** argo's own checks green (`AGENTS.md` § validate: `basalt-ui sync --check`, lint,
typecheck, tests, build); `/review` clean on every merged diff; evidence for the wave written under
`docs/waves/evidence/w<n>.md`.

**Mode:** fleet, orchestrated. The orchestrator tab lives in basalt-ui (herdr tab "T3 stack chart
migration") and runs this plan as a second fleet next to basalt-ui's own plan
(`~/SourceRoot/basalt-ui/docs/waves/PLAN.md`, W12–W15). Each lead follows `/wave` `roles/lead.md`,
fans out with `rd fan`, lands with `rd merge`, and does NOT spawn the next wave.

**Deploys during the migration:** argo deploys every push to master (`deploy.yml`, no path filter),
and 1.x and 2.x cannot coexist in one app. Instead of a long-lived branch (the `rd fan`/`rd merge`
tooling only bases on and lands to master), the migration lands on master with `deploy.yml`
DISABLED (`gh workflow disable deploy.yml`) from the first code wave until cutover; production keeps
serving the last 1.x build, so Warden sees no migration noise. The cutover wave re-enables it.

**Friction rule:** argo never works around basalt-ui. Every basalt friction goes into
`~/SourceRoot/basalt-ui/docs/waves/argo-friction.md` (what you hit, the workaround you did NOT take,
severity, the argo step it blocks) and that step waits for the basalt-ui 2.x minor that fixes it.

## Wave 1 — The migration plan <!-- status: active -->

- [ ] Read basalt-ui's 2.0 ground truth: `~/SourceRoot/basalt-ui/docs/V2-SPEC.md`,
      `packages/basalt-ui/MIGRATING.md` § 2.0 (start at "Upgrading from 1.x"),
      `docs/waves/v2-chart-inventory.md` (argo's 48 chart files mapped to 2.0 kinds),
      `docs/waves/evidence/w2/argo-baseline-1.36.md` (argo's baseline), and the shipped `basalt-app`,
      `basalt-charts`, `basalt-design` skills in the published `basalt-ui@2.0.0` tarball.
- [ ] Inventory argo against it: every 1.x import that moved or died, `useNav`, `runs.has(id)` as
      "live" (`hermes-row.tsx`, `use-hermes-thread-voice.ts`), the telemetry seam vs HyperDX, the
      two diverging pins (root `package.json` 1.41.0 vs `apps/dashboard` 1.36.0), the Table v9 move.
- [ ] Rewrite this file: waves 2..N, three to six steps each, sized for one lead context. Expected
      shape: setup (`basalt-ui init`/`sync`/`doctor`, the pins, disable deploys) → shell, routing and
      route transitions → data and tables → AI chat and the OTel join (`chat.turn` ⇄
      `hermes.stream-lifecycle`) → charts in two or three waves by inventory group → rendering (SSR,
      streamed sections) → cutover (re-enable deploys, verify live: health, OTel, Uptime Kuma,
      screenshots). Each wave names its evidence against the baseline.
- [ ] Commit the plan to argo master; flip Wave 1 to done and Wave 2 to active. Do not start Wave 2.

**Left behind:**
