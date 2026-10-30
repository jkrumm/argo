# Hermes leaves Argo

**Goal:** Argo has no Hermes chat, no Valkey dependency and no inbound path from the VPS to Hermes;
conversation with Hermes lives in the iris app. Owner decision 2026-10-30 (`dotfiles/docs/factory/feedback/2026-10-30-owner-voice-note-replan.md`
item 3): Argo is for analysis, Hermes is reached through iris. Argo moves to the mini later, so less to move.
**Gate:** `make check` in argo green; `/review` on the diff; after the push, the deploy is live
(`make verify`: health `commit` equals `origin/master`) and the dashboard loads every remaining page.

## Wave 1 — Remove the Hermes chat            <!-- status: done -->
Workers: Sonnet for the removal, Haiku for the doc sweep. Orchestrated: do NOT spawn a next wave.

- [x] **Back up first.** Dump `argo.hermes_thread` and `argo.hermes_message` from the VPS Postgres to
  `homelab:/mnt/hdd/backups/argo-hermes-final/` (gzipped SQL plus `SHA256SUMS`, verified on both ends) before
  any migration drops them. No dump, no drop.
- [x] **API:** delete `routes/hermes.ts` and its libs (`hermes-{chunks,events,streams,trace,upstream}.ts`,
  `resumable.ts`, `finish-reason-transform.ts` if nothing else imports it), the DeepSeek thread titling, the
  `REDIS_URL`/ioredis dependency, `HERMES_BASE_URL`/`HERMES_API_KEY` config, and the public
  `/hermes/health/public` route; a Drizzle migration drops the two tables. Keep `/ai` and `lib/ai-sentence.ts`
  (astro/marine verdicts) unless nothing calls them after the removal; say which in Left behind.
- [x] **Dashboard:** delete `features/hermes-chat/`, `HermesWidget` and `HermesVoiceButton` from `routes/__root.tsx`,
  the nav entry and the route; no dead imports, `make check` green.
- [x] **Wiring outside argo:**
  - `vps/apps/argo/compose.yml`: drop argo-api's `valkey-net` and `REDIS_URL`, and the Hermes env lines in
    `vps/apps/argo/.env.tpl`. Remove the `redis` container itself only if no other service on the VPS uses it
    (grep the vps repo and say what you found).
  - `homelab/uptime-kuma/monitors.yaml`: drop the "Argo / Hermes" HTTP monitor, `make uk-sync`.
  - `dotfiles-private/tailscale-acl.jsonc`: drop the `tag:vps → tag:mac tcp:8642` grant once nothing on the
    VPS calls Hermes. Hermes' API on :8642 then binds loopback only (hermes-agent config); prove iris still
    reaches Hermes (a memo routed to Hermes, or iris's own Hermes health probe) after the change. If the ACL
    push needs the owner, write it into Left behind instead of blocking.
- [x] **Docs:** AGENTS.md, README, `docs/HERMES-CHAT-PRD.md` (delete), and any page naming the chat; hermes-agent's
  docs that call Argo its chat surface (`docs/gateway-http-api.md`).
- [x] **Ship:** push to master (RollHook deploys), `make verify`, load each remaining dashboard page once.

**Left behind:** Wave 1 shipped; no further wave in this plan.
- **Live:** argo `a9290f53` (`make verify` health commit = `origin/master`); migration 0029 applied (both tables gone);
  argo-api recreated from the new `vps` compose (no `REDIS_URL`, `HERMES_*` or `valkey-net`); all 14 dashboard routes load
  with zero console errors or failed requests; `/hermes-chat` is the not-found page. The `verifier` could not authenticate
  (token not in the secrets cache), so the walk was done from the orchestrating session with a token read from the VPS env.
- **Backup:** `homelab:/mnt/hdd/backups/argo-hermes-final/argo-hermes-tables-20261030T085810Z.sql.gz` + `SHA256SUMS`
  (8 threads, 52 messages; checksum verified on the homelab end).
- **Valkey container stays:** `fpp` still uses `redis:6379`. Only argo's network attachment and env went.
- **Wiring:** `vps` compose/env (rebased over the audio-gateway removal), `homelab` monitor deleted and `make uk-sync` run
  with `--delete-orphans` (the orphaned `Hermes - HTTP` id 229 is gone), `dotfiles-private` ACL grant `tag:vps → tag:mac :8642`
  removed and applied. Proof: the VPS now times out on the mini's `:8642`; iris `/health` is `ok` with nothing `degraded`
  and Hermes answers `/health` 200 on the mini. A real memo through iris was not sent.
- **/ai kept:** `aiComplete` and `lib/ai-sentence.ts` still serve astro, marine and reading-match. The HTTP routes
  `/ai/v1/chat/completions` and `/ai/v1/models` have **no caller** in the repo; deleting them is the owner's call.
- **Not done — Hermes API loopback bind.** `API_SERVER_HOST` is still the mini's tailnet IP (`op://hermes/gateway/host`),
  which iris also reads as `HERMES_HOST`. Moving to `127.0.0.1` needs `hermes-agent/.env.tpl` and `iris/.env.local.tpl` changed
  together, then the gateway (launchd `ai.hermes.gateway`) and iris restarted (`make launchd-restart`), and
  `hermes-agent/scripts/verify.sh` plus the `hermes-validate` skill probing `$host:8642` adjusted. It is a restart of the live
  gateway, so it was left rather than done mid-wave. The VPS path is already closed by the ACL. hermes-agent docs now say
  iris is the consumer and name the loopback switch as pending.
- **Follow-ups seen, not touched:** `apps/dashboard/src/lib/telemetry.ts` still has `startChatTurn` (chat-turn tracing, no
  caller; its test and basalt's `Telemetry` type keep it alive); `maxRequestBodySize` stays 50 MB (sized for chat
  attachments, no other route checked); the dashboard worker moved Calendar into the Overview nav group so the removed
  Assistant group left no orphan; `fallow audit` flags unused `@elysiajs/bearer` and `@hey-api/client-fetch` and complexity
  in files this wave only touched for comments, all pre-existing.
- **Gate:** `make check` green (1750 dashboard + 543 api tests); `/review` found no code defects (its one blocker was the
  missing dump, which exists); stale comments it listed are fixed.
