# Hermes leaves Argo

**Goal:** Argo has no Hermes chat, no Valkey dependency and no inbound path from the VPS to Hermes;
conversation with Hermes lives in the iris app. Owner decision 2026-10-30 (`dotfiles/docs/factory/feedback/2026-10-30-owner-voice-note-replan.md`
item 3): Argo is for analysis, Hermes is reached through iris. Argo moves to the mini later, so less to move.
**Gate:** `make check` in argo green; `/review` on the diff; after the push, the deploy is live
(`make verify`: health `commit` equals `origin/master`) and the dashboard loads every remaining page.

## Wave 1 — Remove the Hermes chat            <!-- status: active -->
Workers: Sonnet for the removal, Haiku for the doc sweep. Orchestrated: do NOT spawn a next wave.

- [ ] **Back up first.** Dump `argo.hermes_thread` and `argo.hermes_message` from the VPS Postgres to
  `homelab:/mnt/hdd/backups/argo-hermes-final/` (gzipped SQL plus `SHA256SUMS`, verified on both ends) before
  any migration drops them. No dump, no drop.
- [ ] **API:** delete `routes/hermes.ts` and its libs (`hermes-{chunks,events,streams,trace,upstream}.ts`,
  `resumable.ts`, `finish-reason-transform.ts` if nothing else imports it), the DeepSeek thread titling, the
  `REDIS_URL`/ioredis dependency, `HERMES_BASE_URL`/`HERMES_API_KEY` config, and the public
  `/hermes/health/public` route; a Drizzle migration drops the two tables. Keep `/ai` and `lib/ai-sentence.ts`
  (astro/marine verdicts) unless nothing calls them after the removal; say which in Left behind.
- [ ] **Dashboard:** delete `features/hermes-chat/`, `HermesWidget` and `HermesVoiceButton` from `routes/__root.tsx`,
  the nav entry and the route; no dead imports, `make check` green.
- [ ] **Wiring outside argo:**
  - `vps/apps/argo/compose.yml`: drop argo-api's `valkey-net` and `REDIS_URL`, and the Hermes env lines in
    `vps/apps/argo/.env.tpl`. Remove the `redis` container itself only if no other service on the VPS uses it
    (grep the vps repo and say what you found).
  - `homelab/uptime-kuma/monitors.yaml`: drop the "Argo / Hermes" HTTP monitor, `make uk-sync`.
  - `dotfiles-private/tailscale-acl.jsonc`: drop the `tag:vps → tag:mac tcp:8642` grant once nothing on the
    VPS calls Hermes. Hermes' API on :8642 then binds loopback only (hermes-agent config); prove iris still
    reaches Hermes (a memo routed to Hermes, or iris's own Hermes health probe) after the change. If the ACL
    push needs the owner, write it into Left behind instead of blocking.
- [ ] **Docs:** AGENTS.md, README, `docs/HERMES-CHAT-PRD.md` (delete), and any page naming the chat; hermes-agent's
  docs that call Argo its chat surface (`docs/gateway-http-api.md`).
- [ ] **Ship:** push to master (RollHook deploys), `make verify`, load each remaining dashboard page once.

**Left behind:**
