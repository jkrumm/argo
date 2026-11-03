# Argo on the mini, usage v2

**Goal:** Argo runs natively on the mini against the shared Postgres, usage lands in the `usage` schema with sessions
as an entity and no hand-kept prices, Kuma pulls the mini's health through one door, and the VPS no longer runs Argo.
Decisions: `software-factory/docs/decisions.md` (SF8, A1–A4, U1–U5); findings and order:
`software-factory/docs/program.md` §A1; data model boundary: `software-factory/docs/design.md` §9, §11; prices:
`software-factory/docs/research/2026-10-30-price-catalog.md`.
**Gate:** per wave, `make check` in every repo it touched and `/review` on the non-doc changes; from the wave that
deploys, `make verify` on the mini. Nothing leaves the VPS until its replacement is verified live. Own-repo pushes
and deploys are routine.

## Wave 1 — The shared database and the usage schema <!-- status: done -->

Workers: Sonnet. Orchestrated: do NOT spawn Wave 2.

- [x] **Database `shared`** on the mini's main Postgres 18, created idempotently by a target (`make db-shared` here or
      in dotfiles, your call; software-factory's F1 will call the same one, so name it in Left behind). A role per writer
      (`usage`, `argo`, later `factory`), each owning its schema, each with its own connection limit. Passwords in 1Password,
      seeded through `dotfiles-private/headless.refs`. `agent_workflows` stays separate; add a read-only role there for
      Argo (A5).
- [x] **Backups:** a nightly `pg_dump` of `shared` to the homelab, a Kuma push on success, and a restore drill proved
      once. Reuse whatever pattern the mini's backups already follow.
- [x] **Schema v2 in `usage`,** migrations owned by usage-tracker: sessions as an entity with their lane (interactive,
      wave mother, lead or worker, fan worker, subagent type, Hermes, iris, agw workflow, step and route), account,
      subscription or API key, machine, model, effort, repo, `issue_id`, `run_id` (U2); records keyed `(source, source_id)`
      with machine as an attribute (U4); all five token kinds, `cache_write_1h` included. Repo is the directory name under
      `~/SourceRoot`, the same slug as `factory.projects`; normalise from today's 6,376 raw values. Window share per
      session is the headline (U5): store what it needs.
- [x] **`prices`, effective-dated (U3):** a daily sync from LiteLLM's `model_prices_and_context_window.json`, OpenRouter
      as fallback for a model LiteLLM lacks. No catalog publishes history: snapshot, stamp `valid_from`, write a row only on
      change, and seed history from the file's git log. Precedence: provider-reported cost, then `prices`, then a manual
      override table. Checks the research left open: whether LiteLLM carries Haiku 5.5's 100k-token tier and DeepSeek's
      off-peak rates; compare the Claude 5 family against Anthropic's published table once.
- [x] Verify: the schema migrates from empty twice, the sync runs twice with one row per change, a known model prices
      correctly for all five token kinds.

**Left behind:**

- **Database.** `make db-shared` in the vps repo (`scripts/setup-shared-db.sh`, dev host only) creates `shared` and is idempotent; software-factory F1 calls the same target and adds one row to its `WRITERS` table plus a password ref. Roles `usage` (limit 10) and `argo` (limit 20, reuses `op://vps/argo/DB_PASSWORD`), each owning its schema; `argo` reads `usage` (USAGE + SELECT, defaults for future tables). `argo_agw_ro` (limit 5) is read-only on `agent_workflows` (A5). 27 login and privilege assertions end every run. Passwords: `op://mini/vps-dev/{SHARED_USAGE_DB_PASSWORD,ARGO_AGW_RO_DB_PASSWORD}`, sealed into the mini cache via `headless.refs`. Commits: vps `aac18e7`, `fa52d7b`; dotfiles-private `2e6e057`.
- **Wave 3 trap.** `argo` has no CREATE on database `shared`; drizzle-kit's `CREATE SCHEMA IF NOT EXISTS` needs it (setup-postgres.sh grants it on the main DB). Grant it when the schema moves, or the migrate fails. Role limits are cluster-wide, so `argo`'s 20 is shared with the main database.
- **Backups.** The existing nightly (03:15, `backup-pg-dev.sh`) already dumps every database, so `shared` is covered; it now pushes Kuma on a green run only (monitor `MacMini Postgres Backup - Push`, 25 h, declared in homelab `monitors.yaml`, URL in `~/.config/uptime-kuma/pg-backup-push-url`). Drill proved with data in place: 4 databases, `shared` 8 tables / 120 rows, `DRILL PASS`, heartbeat pushed (backup `20261030T101547Z`).
- **Schema.** usage-tracker commit `6572843`: `migrations/pg/0001-0003` (prices machinery with `price_at`/`compute_cost`, sessions + records, quota series), runner `make pg-migrate`, shape and lane vocabulary in `usage-tracker/docs/usage-schema.md`. Applied to `shared` (twice; second run applied 0). `records`, `sessions`, `quota_samples` are empty: Wave 2 fills them. Records are keyed `(source, source_id)`, machine is an attribute, five token kinds as columns (`cache_write_5m` = old total minus the 1h subset). Window share is stored as inputs only (records carry ts, account, cost; `quota_samples`); the attribution rule is two sentences in the doc, no view yet.
- **Prices.** 76 rows (74 `seed-git` from LiteLLM's git log since 2026-04-01, 2 OpenRouter), 41 aliases covering 98.3% of rows and $67,428 of $67,520 recorded cost. Seed ran twice (second wrote 0), `prices-sync` twice (second wrote 0, 38 checked, 0 errors). `claude-sonnet-5-5` at 1M tokens of each kind prices 18.60. Daily `prices-sync` LaunchAgent `com.jkrumm.usage-tracker-prices` installed (04:20, jobrun). Precedence is reported, then `prices`, then `price_overrides`; an override with `supersedes_prices` beats the catalog.
- **Checks the research left open.** Haiku 5.5's 100k tier: LiteLLM carries it for all five kinds (stored as a tier). DeepSeek off-peak: LiteLLM does carry `off_peak_pricing` on `deepseek-v4-flash` and `-v4-pro` (stored, applied by `compute_cost`); `deepseek-v4.1-flash`, the most-used model, is not under `deepseek/` and aliases to v4-flash (its numbers match IU's measured rates). Claude 5 family vs Anthropic's table: matches for all five kinds (`src/prices/anthropic-table.test.ts` pins it against a committed LiteLLM snapshot).
- **Wave 2 inputs.** (1) Repo normalisation: 74 distinct repos from 8,153 raw values, 18% of rows NULL; the sizable NULLs are non-path values that are real SourceRoot names (`audio-gateway`, `hermes-agent`, `research-gateway`, `modelpick`, `prometheus-feuer-agent`, about 15.6k rows) plus `IuRoot/worktrees/*` branch dirs; decide a source-to-repo mapping when the writer lands. (2) IU-specific pricing in `src/pricing.ts` (`reasoningFreeBefore` for gpt-5.6-terra, IU-measured rates, models IU bills differently) must become `price_overrides` rows; list in `usage-schema.md`. (3) 36 unaliased models are listed there too (null model, v3, TTS/transcribe, `<synthetic>`, …). (4) If an upstream rate disappears, `prices-sync` logs an error and keeps the old row every day (intended; there is no acknowledge path yet). (5) usage-tracker's tests use the admin Postgres role to create `usage_test_<hex>` databases (name guard in `src/pg/testing.ts`, recorded in its AGENTS.md).
- **Gate.** `make check` green in usage-tracker (357 tests, Postgres suites running); vps has no check target, the script's own assertions are its gate. `agw review` on the usage-tracker diff found one blocking test defect (`afterAll` inside test bodies) and five improvements; all but the rate-stall were fixed and `make check` re-run, no second review pass. Two incidental facts: `op item edit` on the MacBook needs `--account tkrumm` and `</dev/null`; the first `ask-human` seed attempt failed on the missing field, the fields now exist.

## Wave 2 — usage-tracker writes `usage` directly <!-- status: done -->

Workers: Sonnet. Orchestrated.

- [x] usage-tracker inserts into the `usage` schema (U1); its SQLite staging and 15-minute sync to Argo go, the pricing
      in `src/pricing.ts` goes. Argo's copy (`lib/ai-usage.ts`) stays until Wave 3.
- [x] Backfill history once from `argo.usage_record` on the VPS: the $3,081 of duplicates from the old key disappear by
      the new key; prove totals per source and month against the old table and explain every difference. The VPS table is
      not touched.
- [x] `agw`'s usage outbox targets the same table (agent-workflows); run dedup across both writers.
- [x] Company API spend reconciled to portal actuals per key and day; 1,631 unpriced IU rows priced or explained.

**Left behind:**

- **Live since 2026-10-30 12:25Z, and Argo's usage pages are stale since then.** The installed LaunchAgent runs `bun run src/cli.ts ingest` from the usage-tracker working tree, so the Postgres pipeline went live the moment it was committed; there is no Argo push any more (usage records, quota samples, picker decisions, IU portal). agw's host writes `usage.records` natively since its deploy at 12:45Z (release `073bbc9`, `make verify` PASS). Until Wave 3, the VPS dashboard's usage, quota, routing and IU-cap views stop at those times. The plan accepted this; Wave 3 is what ends it. Still posting to the VPS table only: email-gateway and any other VPS caller (about 105 rows, $0.01 so far); Wave 4 bridges them.
- **Where the code is.** usage-tracker `0b738e0`..`e197de0` (pushed), migrations `0004-0009` applied live: state and portal tables, IU price overrides (`0005`: no DeepSeek, see below), gateway-duplicate marks. Writer `src/pg/writer.ts` (`upsertRecords`, sessions, `usage.compute_cost` for cost), ingest/report/budget/reprice on Postgres, SQLite staging, `sync*`, `relane`, `pricing.ts` and `pricing-drift` deleted. The SQLite file `~/.local/share/usage-tracker/usage.db` is kept as the archive and pre-image of the old costs. agent-workflows `321adfb` + `4dee3c7`/`073bbc9`: `UsageOutbox` writes `usage.records`/`usage.sessions` in one transaction per chunk (own pool of 2, write deadlines, sorted lock order); `ARGO_URL`/`ARGO_API_SECRET` stay in its `.env.tpl` for the overview push and podcast notice only.
- **Backfill.** `make backfill-argo` (insert-only for every source by default; `OVERWRITE=<sources>` refuses while the agent is loaded unless `FORCE=1`), `make import-sqlite-state`. Proof `usage-tracker/docs/backfill/2026-10-30-argo-usage-record.md`: 74 of 74 source-months close in rows, five token kinds and cost. 871,861 rows, $62.3k against Argo's $69.1k: the gap is cost re-derived through `usage.prices` ($-4,141 and $-2,570 by whether the row has 1h writes; `claude-sonnet-5-5` Max rows alone -$5,467 because the old family fallback priced them at 3/15 against the catalog's 2/10), 4,217 rows that lost a price ($69.65, `v3` ElevenLabs and TTS models) and sonar's ignored reported cost. Reported costs are verbatim. Dedup by the new key collapses 2 rows: **the $3,081 of duplicates does not reproduce** on this snapshot. 54,986 sessions, none with a span that differs from its records.
- **Dedup across both writers.** No overlap between agent-workflows rows and any collector (0 pairs, same model and tokens within 5 %, +-60 s; on the team key agw alone ties to the portal per model). The real double count was the audio/image gateway family stored twice (collector log plus the gateway's own Argo push): 2,278 rows, $72.34 ($31.23 in October) are marked in `usage.record_duplicates`. **Every reader must read `usage.records_unique`, not `usage.records`** (Wave 3: the Argo usage queries). Nothing was deleted; undo is `DELETE FROM usage.record_duplicates`.
- **Reconciliation** `usage-tracker/docs/reconciliation/2026-10-30-portal-actuals.md`, per key and day. Personal key rolling-30: portal $595.30, tracked $501.76 (-$93.54, 84 %); athena-team $154.42 vs $154.75. The first look (+2 %) was two errors cancelling: the old 16:30-00:30 DeepSeek window overstated by $75 (the catalog schedule fits the portal at 0.96x and 0.89x, so `0006` removed those overrides) and the gateway duplicates by $31. Residual: 2026-10-22 Claude spend the portal bills and no row records (-$43.08), a 24 h hole between the `opencode` and `agent-gateway-opencode` collectors on 10-13/14 (-$20.46), Haiku 5.5 cache-write TTL, which OpenCode reports as one total (-$11.11), DeepSeek schedule residue (-$14.82), scatter $5.02. Unpriced IU rows are 10,904, not 1,631 (the plan's figure was stale): every model is explained (ElevenLabs TTS and transcription priced per character or minute, tool calls, placeholders, a free local model), the portal total of all of them is about $2 in 30 days.
- **Owner questions.** (1) What ran on the personal IU key on 2026-10-22 ($43 of Claude, the data does not name a producer)? (2) `.env.test.tpl` puts the admin Postgres credential into every test process; a CREATEDB-only test role would be tighter (usage-tracker and agent-workflows).
- **Wave 3 inputs.** `argo` can SELECT every `usage` table and view including `records_unique` (checked). Wave 1's trap still stands: `argo` has no CREATE on database `shared`. The cursor is saved after a collector's whole batch, so a run killed at jobrun's 600 s deadline restarts that scan next tick (the first PG run during the backfill was killed once; since then runs finish well inside the deadline). Open collector work, not blocking: the Haiku 5.5 TTL split in the OpenCode collector, a per-batch cursor.
- **Gate.** `make check` green in usage-tracker (356 tests, Postgres suites running) and agent-workflows (2974 pass). `agw review` found 4 blocking in usage-tracker (NUL strip over serialized JSON, an error-path state write aborting the run, a backfill default that overwrote live rows, a non-per-store duplicate pairing) and 2 in agent-workflows (a timed-out write that could still commit, a partial cost posted as final); all fixed with tests, 0009 applied live (flagged set unchanged, 13 originals re-pointed), agw redeployed, no second review pass. `fallow` still reports CRAP/complexity on the one-off backfill scripts (advisory, not part of `make check`). Flaky once each, green on rerun: agw `check-real` credential test under `agw check`, `opencode-host` steer/abort, usage-tracker `git-history` baseline.

## Wave 3 — Argo reads the shared database <!-- status: done -->

Workers: Sonnet. Orchestrated.

- [x] Argo's usage pages read `usage`; `lib/ai-usage.ts` pricing and the ingest endpoint go.
- [x] Argo's own schema moves to `shared` on the mini: a dump from the VPS, restored, row counts and checksums proved.
      While Argo still runs on the VPS, it keeps the VPS database; this step is a rehearsal the cutover repeats.
- [x] Delete what has no caller: `/ai/v1/*` HTTP routes (`aiComplete` stays), `startChatTurn`, the 50 MB body limit if no
      route needs it, the unused `@elysiajs/bearer` and `@hey-api/client-fetch`.

**Left behind:**

- **Pushing this deploys code the VPS cannot run.** Master auto-deploys to the VPS (RollHook), whose database has no
  `usage` schema: every `/usage/*` GET there now answers 500 (they were already frozen since 2026-10-30 12:25Z), and
  `POST /usage/*` is 404 for the one remaining VPS caller (email-gateway, about 105 rows so far, fire-and-forget).
  Nothing else on the VPS is touched (no migration in this wave, legacy tables kept). Wave 4 brings the dashboard back
  with Argo itself on the mini; Wave 4 must bridge email-gateway's posts or accept their loss.
- **Where the code is.** argo `744c0383` (AI routes, telemetry, deps), `42016223` (`make db-rehearse`), `f41f59fb` (usage
  reads); vps `1c0b7db` (`argo` gets CREATE on database `shared`; the migrator's `CREATE SCHEMA IF NOT EXISTS` needs it,
  asserted by `make db-shared`).
- **Usage read model.** `apps/api/src/lib/usage-source.ts` (`USAGE_ROWS`) projects `usage.records_unique` onto the old
  column names, so all queries and the dashboard are unchanged: `project` = repo without the `iu/` prefix, else a bare
  `project_raw`; `sub_tool` = workflow(:step) / subagent type / raw / lane (so `wave` reads `wave_mother` now);
  `billing` `api_key` -> `iu` (with key) or `openrouter` (without); `cache_write_tokens` = 5m + 1h. Pinned by
  `src/db/usage-source.test.ts`. Quota percentages are integers in `usage.quota_samples` (were doubles). Real data through
  the app as role `argo`: summary 873,534 rows, headline 1.3 s (seq scan of 30 days over 840k rows; an index or a cache
  belongs to usage-tracker/Wave A2 if it hurts), the rest under 500 ms.
- **Legacy tables stay.** `usageRecord`, `quotaSample`, `accountPick`, `iuPortalCost/Total` are still declared in
  `db/schema.ts` (no reader, no writer) so `db:generate` never emits a DROP against the VPS; Wave 6 drops them with the
  cutover. The rehearsal leaves them out of the copy.
- **Rehearsal.** `make db-rehearse` (`bun db:sync` is the same): one REPEATABLE READ snapshot on the VPS gives dump and
  per-table row count + md5; the restore into `shared.argo` runs as role `argo` in one transaction that recomputes the
  checksums and COMMITs only on a match. Proved twice (22 tables, 3,056 rows, identical; 315 MB dump, about 35 s), plus the
  failure path (rolled back, schema untouched, no dump left in the VPS container). Argo's own `runMigrations()` as role `argo`
  on the copy is a no-op (journal 30). **Wave 4:** the copy carries the mark `argo rehearsal copy`; once Argo runs live from
  `shared`, replace the mark (`COMMENT ON SCHEMA argo IS 'live'`) or the next rehearsal would wipe it (the script refuses
  without the mark unless `FORCE=1`, which Wave 6's cutover sets after stopping Argo on the mini). `bun dev`, `db:migrate` and
  `test:api` now use database `shared`.
- **Deleted.** `/ai/v1/*` routes (`aiComplete` moved to `lib/ai-complete.ts`, its usage is a log line `argo ai usage`, not a
  `usage` row: Argo only reads that schema, so its few verdict-sentence calls show up as portal-minus-tracked on the
  personal key), `startChatTurn`, `@elysiajs/bearer`, `@hey-api/client-fetch`, all four ingest POSTs and their tests. The
  50 MB body limit was not removed but lowered to 8 MB: removing it would raise the cap to Bun's 128 MB default, and the
  largest legitimate body is a 1 MB snapshot.
- **Tests.** `bun test:api` creates a scratch database `argo_test_<hex>` as admin, applies usage-tracker's
  `migrations/pg` (`USAGE_MIGRATIONS_DIR` overrides the path) and drops it again: 942 pass. Ingest-behaviour tests were
  deleted with the endpoints.
- **Gate.** `make check` green; `bun test:api` 942 pass, 0 fail; `agw review` on the uncommitted diff: one blocking (a
  plaintext dump left in the VPS container when the rehearsal fails midway) fixed with a cleanup trap and `umask 077`, one
  improvement fixed (restore committed before the checksum compare, now atomic); not acted on: a boot check for the `usage`
  schema (would fail the VPS boot), the `maxTs` text form (unchanged from the old driver behaviour), restoring fractional
  quota percentages (the column is integer). No second review pass.

## Wave 4 — Argo native on the mini <!-- status: done -->

Workers: Sonnet. Orchestrated.

- [x] Native like agw (A1): release directories, launchd, rollback, `make deploy|verify`, no Docker, no RollHook. OTel to
      ClickStack's authed tier. The OAuth token files move with `DATA_DIR`.
- [x] Bridges flip to loopback: agw overview push and usage outbox, Hermes narratives. VPS callers (email-gateway usage
      posts) get a port-scoped VPS → mini grant, the same pattern as weatherorb's. **Not done, on purpose: see Left behind.**
- [x] The dashboard reachable as today, every page loads, on the rehearsal data.

**Left behind:**

- **Argo runs natively on the mini, live since 2026-10-30 ~15:00Z.** Release `fb2361275956` (`make deploy` then `make verify`: PASS; `make verify-pages`: 14 of 14 routes load). Commits: argo `25653cef` (API: `DASHBOARD_DIR` serving, `/api` prefix strip, OTLP relay, `HOST`, `CRONS_ENABLED`), `fb236127` (deploy tooling), then the close-out commit; dotfiles `argo-live` Caddy door + launchd row; dotfiles-private `057e1e6` (6 refs for the secrets cache, sealed via `ask-human`); hermes-agent narratives base on loopback. Nothing on the VPS was touched; the VPS copy keeps auto-deploying from master with unchanged defaults (`DASHBOARD_DIR` empty, crons on).
- **Layout.** `~/.argo/{repo,releases/<sha>,current,data/{deployed-sha,previous-sha,err-log-offset},state}`; LaunchAgent `com.jkrumm.argo` (KeepAlive, `127.0.0.1:7737`, logs `~/Library/Logs/argo.{out,err}.log`); `make deploy|verify|rollback|logs|verify-pages`. `state/` is `DATA_DIR` (OAuth token files go there at the cutover, copy `oauth-tokens.json` from the VPS `/var/lib/argo/data`). One process serves the SPA, `/api/*` (prefix stripped) and relays the browser's `/v1/traces|logs` (2 MB cap) to the authed OTLP tier. In dashboard mode root `/health` is the SPA: probe `/api/health`. Spans of the native process (`service.version` = the sha) reach prod ClickStack; verified by query.
- **Door.** `https://<mini-door-host>` (dotfiles `config/Caddyfile` block `argo-live.test` -> :7737, tailnet clients on 443). `argo.test` stays the Vite dev server. No `tailscale serve` row and no ACL change.
- **Mini copy is not the live one.** `CRONS_ENABLED=false` in the plist (flip it at the cutover), no Google / Garmin heartbeat / Docker refs in `.env.tpl` yet (the cutover adds `GOOGLE_*`, `GARMIN_HEARTBEAT_URL`, `DOCKER_*`). It runs as role `argo` on the rehearsal copy `shared.argo`; the schema keeps the `argo rehearsal copy` mark, so a `make db-rehearse` would wipe what the bridges pushed since (agents overview, narratives): fine, the cutover repeats the copy with `FORCE=1`. Pages that call Google or M365 answer 503 ("not authenticated") by design; every other route the pages call answers.
- **Bridges flipped.** agw: `op://mini/agent-workflows/ARGO_URL` is now `http://127.0.0.1:7737/api` (1Password field edited and cache resealed through `ask-human`, host restarted with SIGTERM; the overview push landed on the mini at 15:21:47Z). Hermes: `project-narratives.py` defaults to the loopback base (next run 06:30). **Consequence until the cutover:** the live VPS dashboard's Agents page and the podcast Slack notice no longer get fresh pushes (the same freeze the usage pages already had). Narratives posted before the cutover land on the rehearsal copy and are overwritten by the final restore.
- **Deviation, VPS → mini grant not made.** The plan's premise was an endpoint for email-gateway's usage posts, but Wave 3 deleted every ingest route (Argo only reads `usage`), so there is nothing a VPS caller could post to. email-gateway (`vps/apps/email-gateway/.env.tpl` `EMAIL_GATEWAY_ARGO_USAGE_URL`) and image-gateway (`ARGO_USAGE_URL`) keep posting to `http://argo-api:4000/usage/records` and get a fire-and-forget 404 (about 105 email rows, $0.01; the image-gateway family is already counted by the collector, Wave 2). Decision for Wave 6 or the owner: unset both URLs, or have email-gateway write `usage.records` itself (agw's outbox is the pattern).
- **Docker reach, found now, belongs to the cutover.** From the mini, homelab `:2376` is closed (no `tag:devhost -> tag:homelab` grant) and the VPS socket-proxy is a Docker-network name. `/docker/*` and `/summary` therefore cannot reach their targets on the mini copy. The dashboard has no Docker page; callers are the API/agents. The cutover needs the ACL grant for homelab `:2376`, a tailnet-bound socket-proxy on the VPS (or a different source), and `HOMELAB_TAILSCALE_IP` / `DOCKER_*` in `.env.tpl`.
- **Smaller.** (1) `apps/dashboard/src/lib/hyperdx.ts` `tracePropagationTargets` lists only `argo.jkrumm.com`, `argo.test` and localhost; browser-to-API trace propagation will not fire on `argo-live`. (2) Unauthenticated requests are recorded as 500 on their span although the response is 401 (Elysia's thrown status; same on the VPS). (3) The relay and static files have no gzip/ETag (nginx had gzip). (4) Spans of the process are `service.version` = sha, the VPS copy reports `0.0.0`.
- **Gate.** `make check` green (incl. fallow); `scripts/test/deploy-logic.sh` 27 cases (stubbed launchd), real deploy and `make verify` on the mini. `agw review` on the uncommitted diff found 4 blocking (lock acquisition race, rollback reading markers before the lock, a failed rollback leaving the previous release's plist, an OTLP 204 turned into 502) and 5 improvements (marker order, signal traps, relay failure log, 2 MB relay cap, symlink escape); all fixed with tests (lock is now an atomic symlink), no second review pass. One security question (a write-capable API on the mini) answered in place: it writes only the rehearsal copy (`argo` has SELECT on `usage`), is bound to loopback, reached via the tailnet-only door and the bearer guard. Rollback and the failed-health path were exercised only with stubs, not on launchd.

## Wave 5 — The Kuma door <!-- status: done -->

Workers: Sonnet. Orchestrated.

- [x] One tailnet port on the mini, granted to the homelab only (A3). A registry in dotfiles maps a name to a local
      health URL; `GET /h/<name>` returns the status and a capped body, GET only. Kuma's monitors are generated from the
      same registry. Push stays for jobs.
- [x] Wave 4 review fixes (second `agw review`, 7268fa58..0ba778cf): atomic stale-lock takeover in `deploy.sh`, the lock held
      across the re-exec, `HOST` fails closed in dashboard mode, the OTLP relay injects the ingest key server-side and runs under
      one deadline, Kuma URL and username out of the plist into `.env.tpl` refs and hostnames out of AGENTS.md / PLAN.md. Then
      redeploy and `make verify`.

**Left behind:**

- **The door is live.** One port, `8795` on the mini, tailnet-only (`tailscale serve` row in dotfiles-private, `tag:homelab -> tag:devhost tcp:8795` grant, pushed). It binds 127.0.0.1; `GET /h/<name>` relays the registry's fixed loopback URL (nothing from the request reaches it), returns the upstream status and at most 4 KiB, GET/HEAD only (POST answers 405). Proved from the homelab: five services 200, POST 405; from the VPS and the homelab on `:443` the connection is refused. Code: dotfiles `kuma-door/` (`registry.json` is the single registry, `registry.ts` validates, `door.ts` serves, `gen.ts` generates), LaunchAgent `com.jkrumm.kuma-door` (KeepAlive), `make kuma-door-{setup,restart,teardown,gen,check,test}`; the devhost heartbeat probes `/healthz`. To add a service: edit `registry.json`, `make kuma-door-restart kuma-door-gen`, commit the generated file in homelab, `make uk-sync`.
- **Kuma is generated from it.** homelab `uptime-kuma/monitors.mini-door.generated.yaml` (committed, do not edit; `make kuma-door-check` fails on drift) is merged by `sync.py`, whose `--extra-config` is now repeatable. Monitors sit in group `Local` / `Mac mini door`; all five (`argo`, `agw-host`, `agw-audio`, `brain-web`, `walkingpad`) are UP in Kuma after `make uk-sync`. Push stays for jobs and for the composite `MacMini Dev Host - Push`. The monitors use the MagicDNS name (`op://homelab/config/MINI_TAILSCALE_HOST`), not the IP: `tailscale serve` has no cert without SNI (TLS alert), and MagicDNS resolves inside the Kuma container.
- **Wave 4 review fixes, live.** Release `a7ab4b13020d` deployed, `make verify` PASS, `make verify-pages` 14 of 14. `deploy.sh` takes the lock by an exclusive `ln -s` and removes a dead holder's link under an `mkdir` guard after re-reading it (compare-and-swap; the test races 20 processes for a stale lock, three rounds, and fails on the old code); the lock stays held across the re-exec (`ARGO_DEPLOY_LOCK_HELD`, honoured only when the lock names the child's pid). `HOST` defaults to 127.0.0.1 when `DASHBOARD_DIR` is set. The OTLP relay drops the client's `authorization`, sends the process's own `OTEL_EXPORTER_OTLP_HEADERS`, and one deadline covers the body read and the upstream call (408 on a slow sender); checked live: a bogus client key still answers 200. The Kuma URL and username left the plist for `.env.tpl` refs (`op://common/uptime-kuma/{URL,USERNAME}`, sealed into the mini cache). Hostnames in AGENTS.md / PLAN.md are placeholders.
- **Second review of those fixes (program lead): one blocking, fixed.** `HOST` used `??`, so `HOST=""` with `DASHBOARD_DIR` set bound every interface; an empty or blank `HOST` now counts as unset (`||` over the trimmed value), with a test for `''` and `'   '` in both modes. Redeployed, `make verify` PASS.
- **Owner-gated steps done through `ask-human`:** the 1Password fields (`common/uptime-kuma` URL and USERNAME, `homelab/config` MINI_TAILSCALE_HOST), the cache reseal, and the ACL push after a diff that held only the new grant (the push needs `ACL_PUSH_YES=1` when run non-interactively).
- **Gate.** `make check` green in dotfiles (28 -> 29 door tests) and homelab (`make test`, 29 sync-guard cases); argo `make check` and `deploy-logic.sh` green. `agw review`: dotfiles found 2 blocking (`kuma-door-setup` never reloaded a changed plist: now bootout then bootstrap; a loopback URL with an explicit `:80` was rejected: fixed with a test) and 4 improvements, of which `kuma-door-restart` now validates the registry first; homelab clean, its skipped-extra-config warning added. Not acted on, deliberately: the door relays the upstream body (4 KiB cap) as decision A3 says, although Kuma only reads the status, so a service whose body is sensitive should not be added without trimming it; `KUMA_DOOR_PORT` stays as a test override; the heartbeat probes `/healthz` only (`make kuma-door-check` covers a service route). No second review pass.
- **Wave 6 inputs.** (1) `make db-rehearse` still refuses without `FORCE=1` on the live copy, as Wave 4 said. (2) The Docker reach, the email-gateway/image-gateway usage posts and `tracePropagationTargets` stay open from Wave 4. (3) `argo` on the mini runs with `CRONS_ENABLED=false` until the cutover. (4) A deploy of a sha whose `deploy.sh` predates the lock fix would refuse at the re-exec; only possible if master moves to an older script.

## Wave 6 — Cutover <!-- status: done -->

Workers: Sonnet. Orchestrated.

- [x] Final dump, restore, DNS or tunnel switched, `make verify`, every page once.
- [x] VPS Argo stopped; its database kept, stopped, with a verified final backup on the homelab. Dropping it is a
      business decision and goes to the owner through `ask-human.sh`.
- [x] The dead usage posts (program lead, 2026-10-30): unset `EMAIL_GATEWAY_ARGO_USAGE_URL` (`vps/apps/email-gateway`) and image-gateway's `ARGO_USAGE_URL`, and drop the code that posts when they are empty. email-gateway's model spend is then not in `usage`; say so in `docs/usage-reconciliation.md` as a gap for track U (route its calls through agw, or let it write `usage.records` through agw's outbox).
- [x] ADR-009's VPS role retired; `docs/`, `vps/AGENTS.md`, `docs/architecture.md` in dotfiles say what runs.

**Left behind:**

- **Argo is live on the mini as `argo.jkrumm.com`** (cutover 2026-10-30, 16:43Z VPS stopped, ~17:50Z DNS switched). Release `1b9a25774fbc`, `make verify` PASS, `make verify-pages BASE=https://argo.jkrumm.com` PASS 14 routes (the first two runs showed one random empty page each at load average ~130 on the mini; the third was clean). Crons run on the mini (`CRONS_ENABLED=true`); the first Garmin sync after the cutover finished `ok`. Google/M365 tokens work (`oauth-tokens.json` copied from the VPS into `~/.argo/state`, mode 600).
- **How the hostname moved.** The A record (DNS-only) now holds the mini's tailnet IP. The mini's Caddy serves it as an _extra FQDN door_: new dotfiles feature, machine-local `~/.config/caddy-tailnet.hosts` (`<fqdn> <app>`), own Let's Encrypt cert by DNS-01, same homelab/VPS 403 guard, no landing page. Clients tag:mac/phone/tablet reach it on :443; the homelab and VPS do not (Kuma uses the Kuma door `Argo - Door`; the three VPS-era Argo monitors are deleted in Kuma and in `homelab/uptime-kuma/monitors.yaml`). Nothing else called `argo.jkrumm.com` from the VPS or homelab (grepped).
- **Cutover mechanics (reusable).** (1) `gh workflow disable deploy.yml` (a push redeploys the VPS otherwise: it did once, from my own push, before I stopped it), (2) `docker stop` the two VPS containers, (3) a one-off script (not kept) dumped the whole `argo` schema in custom format from one REPEATABLE READ snapshot, restored it into a scratch database on the mini and compared per-table rows and md5 with the source (27 tables, 877,127 rows identical) before copying it to the homelab with sha256, (4) `launchctl bootout` Argo, `FORCE=1 LIVE=1 make db-rehearse` (22 tables, 3,054 rows identical; marks the schema `argo live ...`), (5) token file, plist `CRONS_ENABLED=true`, `make deploy`, (6) A record, (7) verify.
- **Backup.** `homelab:~/argo-backups/argo-schema-final-20261030T1643Z.{dump,sums,sha256}` (128 MB, mode 600, sha256 checked on the homelab, scratch-restore proved). The earlier identical dry-run set `...T1640Z.*` was deleted on 2026-11-03.
- **VPS copy dropped (owner decision 2026-11-03, `ask-human` `20261030T181512-13710`, two-week window waived).** Removed on the VPS: the stopped containers `argo-argo-api-520` / `argo-argo-dashboard-517` and their two `argo-api` / `argo-dashboard` images (tag `d2d47020`); in database `postgres` the `argo` schema (27 tables, 928 MB, incl. the five legacy usage tables), the legacy `drizzle` schema (Argo's pre-relocation journal, its three hashes are argo's first three migrations, owned by `argo`), then `DROP OWNED BY argo` in `postgres` and `weatherorb_accounts` and `DROP ROLE argo` (checked first: `weatherorb_accounts` held 0 argo-owned relations, so there it only revoked grants; 0 `argo` sessions open); the host dirs `/var/lib/argo` (the old bind mount: `oauth-tokens.json`, already copied to the mini at the cutover, and the SQLite `homelab.db` of May 2026, superseded by Postgres) and `/var/backups/argo` (a May 2026 pre-Postgres copy of that SQLite file), not backed up: both predate the data in the cutover dump. Nothing else on the VPS touched. `deploy.yml` was already deleted at the cutover; no VPS deploy tooling is left in the repo. Rollback is now a restore: the nightly `shared` backup first, the cutover dump as last resort (AGENTS.md §Deploy). The `op://vps/argo/*` refs stay: the mini's copy reads them.
- **Dead usage posts.** email-gateway (`d2615dc`) and image-gateway (`b230b30`) lost the Argo reporter, the env vars and their tests (email-gateway keeps its `llm.*` spans in `src/telemetry/llm-call.ts`; image-gateway keeps `request.done`); both pushed, email-gateway deploy on the VPS healthy. `vps` env lines removed. Gap recorded in `docs/usage-reconciliation.md`.
- **VPS role retired.** argo: Dockerfiles, nginx.conf, `.dockerignore`, `deploy.yml` deleted; AGENTS.md, README, `apps/api/AGENTS.md`, DEPLOY-VERIFICATION rewritten. vps: `apps/argo/`, all `make argo-*` targets, docs (new `## Retired: Argo` section). dotfiles/homelab/hermes-agent docs: see their commits (below).
- **New guards.** `scripts/live-guard.sh` (sourced by `dev.sh` and `db-migrate.sh`) refuses to point a dev workflow at a schema marked `argo live`, failing closed when the mark is unreadable; `ARGO_DEV_ON_LIVE=1` overrides. `dev.sh` also forces `CRONS_ENABLED=false`. `db-rehearse.sh` keeps a live mark through a forced restore. `bun db:sync` copied from the frozen VPS copy until 2026-11-03; it is now `scripts/db-sync.sh`, a read-only dump of the live mini schema over `ssh mini` (`db-rehearse.sh` deleted), tested on the mini into a scratch database: 22 tables, rows + md5 identical, a table the source no longer has is dropped; it refuses the live schema by its mark and, independently, by cluster identity.
- **Open, not done.** (1) **`/docker/vps/*` and the VPS half of `/summary` answer an error** (500 on `/docker/vps/summary`, `dockerVps` error object in `/summary`): the VPS socket-proxy only listens on the VPS Docker network, and publishing it on the tailnet is a security decision I did not take. Hermes' infra skill uses those endpoints (the skill docs now say so). The homelab half works (new tailnet grant `tag:devhost -> tag:homelab tcp:2376`, pushed; Docker address derived from `HOMELAB_TAILSCALE_IP`). Decide: publish a read-only proxy on the VPS tailnet IP with a `tag:devhost` grant, or take VPS containers from Beszel (decision A4). (2) `garmin-sync.ts` and `hardcover-sync.ts` set `inProgress` outside a try/finally, so a Postgres error on the control row sticks the flag until restart (review finding, pre-existing). (3) The earlier Wave 4 smaller items stay: 500 recorded on 401 spans, no gzip/ETag on static files. (4) `observability/dashboards/argo-api.json` has a widget on `ServiceName = 'argo-dashboard'`; the mini only emits `argo-api` server spans plus the browser's `argo-dashboard`, so it may be thin. (5) The Garmin push URL was exported on a span attribute (`url.full`) until now; the heartbeat uses plain `fetch` since `1b9a2577`. Past spans in ClickStack still hold it; rotating the Kuma push URL is optional.
- **Gate.** argo `make check` green on the final tree (550 tests; one run failed on `astro-visibility` at 6.1 s against the 5 s default under load average 130, passes alone and on the rerun). vps `make check` OK; email-gateway 858 tests, image-gateway 513 tests green. `agw review` on `4a8d63ea..HEAD`: 4 blocking (dev guard failed open, `db:migrate` unguarded, forced restore demoted the live mark, heartbeat secret on a span) all fixed in `1b9a2577`, 3 improvements (rollback recipe now stops the mini first and forbids releases older than the cutover; `inProgress` left as open item 2). No second review pass.

## Wave 7 — Kuma monitors carry their group and last message <!-- status: done -->

Worker: Sonnet. Requested by the dotfiles Herdr app (an Uptime tab that rebuilds Kuma's grouped overview from Argo instead of reading Kuma's SQLite).

- [x] `GET /uptime-kuma/monitors` (`apps/api/src/routes/uptime-kuma.ts`, client `apps/api/src/clients/uptime-kuma.ts`): each monitor gains `parent` (the parent group monitor id as a string, or null; from `monitorList` and `updateMonitorIntoList`), `msg` (newest heartbeat message or null) and `lastBeatAt` (ISO or null), from `heartbeatList` (newest beat) and live `heartbeat` events. Each field `.describe()`d in the zod schema (OpenAPI is the agent interface, `apps/api/.claude/rules/openapi.md`). Additive only: existing fields and `/uptime-kuma/status` unchanged.
- [x] Tests for the mapping (parent from `monitorList`, msg/lastBeatAt from `heartbeatList` and a live `heartbeat`) in the existing test style.
- [x] Deploy per AGENTS.md §Deploy; `make verify`.

**Gate:** `make check` green; deployed; live, `/api/uptime-kuma/monitors` on `127.0.0.1:7737` with the `op://common/api/SECRET` bearer shows a non-null `parent` and `msg` for `Samba - Docker`. Close-out names the final field names (a consumer in dotfiles reads them).

**Left behind:**

- **Final field names** on each `GET /uptime-kuma/monitors` entry (additive; existing fields and `/uptime-kuma/status` unchanged): `parent` (string | null, the parent group monitor's `id`; from `monitorList` / `updateMonitorIntoList`), `msg` (string | null, newest heartbeat message, an empty message is null), `lastBeatAt` (string | null, ISO UTC of the newest beat; Kuma's `YYYY-MM-DD HH:mm:ss` time is parsed as UTC). `msg` and `lastBeatAt` come from the newest beat of `heartbeatList` and are replaced by every live `heartbeat` event.
- **Live, release `a482d7f46b6a`.** `make verify` PASS. `Samba - Docker`: `parent "55"`, `msg "healthy"`, `lastBeatAt` set; 109 monitors with a parent, 117 with a msg.
- **Gate.** `make check` green (550 tests; new `apps/api/src/clients/uptime-kuma.test.ts`, 7 cases, drives the client through a fake socket). Not run: `/review`, the change is additive mapping over three fields. The first `make check` failed on `basalt-ui sync --check` only because local `node_modules` held basalt-ui 2.29.0 against the lockfile's 2.27.2; `bun install --frozen-lockfile` fixed it, no repo change.
- Wave 7 was the last wave of this chain; Wave 8 is run by the agent-workflows fleet.

## Wave 8 — Usage view v7 <!-- status: done -->

Run by the agent-workflows fleet (its PLAN Wave 7b; mother `agent-workflows-w1-r4`). Spec `docs/design/usage-tracking.md`
v7, signed by the owner 2026-11-02 18:20 (`9fd63c7f`): decisions 1–4 as recommended, 5 (production pacing) deferred to
7 days of post-hotfix data, plus §Insights.

- [x] agw side (agent-workflows, through fan worktrees and its merge train): GPT fallbacks marked on the gateway rows and
  the caller of agw recorded, per spec decision 3. The double rows are fixed by agent-workflows Wave 8; build on that.
- [x] Endpoints on `usage.*` per the spec (gateway rows, picks, credit cycles, platform cost, quota samples), including
  `/usage/insights`: 3–5 ranked rule-based observations under the verdict, numbers never model-written (optional
  `agw digest` wording only).
- [x] Views Flow and Explore per the spec; the v6 views they supersede (Overview, Claude Max, IU API, Credits) deleted,
  not hidden. Tests.
- [x] Deploy, `make verify`; screenshots light and dark through `@verifier`, checked against the mocks.

**Gate:** `make check` in every repo touched, `/review` on non-doc changes, deployed and live-verified.

**Left behind:**

- **Live: argo release `6702133977ad`** (`make verify` PASS, `make verify-pages` PASS 14 routes), **agent-workflows
  release `f5b3df101f57`**, gateway build `d306b78a29d319c2` (`make verify` PASS, deployed with r12's OK; r12 notified).
  The usage page has two tabs, **Flow** (default) and **Explore**; Overview, Claude Max, IU API, Credits and
  `/usage/credits/*` are deleted (old URLs and stored tabs migrate to Flow with the matching `?node=`).
- **What landed.** argo #213 `GET /usage/pace` (per-day max of meter and report, the waterfall, spill, verdict, eval
  reserve; `/usage/iu-budget` gains `underCapOn`), #212 `GET /usage/router`, `GET /usage/demand`, `/usage/split?by=lane`,
  #214 Explore + subscription and IU key details, #215 `GET /usage/insights` (seven template detectors, top 5, `unavailable`),
  #216 Flow (verdict band, pace chart, Supply/Router/Demand nodes, details, Athena apart, insights strip), #217 Athena
  guard in pace, `router.lastRequestAt` and the "last request {age} ago" note, the credit-payer DB tests, #218 polish from the
  live verification. agent-workflows #114: `x-agw-origin` → `lane_detail.origin` and `x-agw-route-fallback` →
  `lane_detail.routeFallback` (the 402's request id, which joins its `refused` pick).
- **Gate evidence.** Spec pass criteria, live 2 Nov ~21:00 UTC: (1) verdict, credit left and IU clause in the first
  viewport at 1440 and 390, PASS; (2) `/usage/pace` `leftUsd` − gateway `/health` `creditLeftUsd`: iu $2.06, me $2.00, PASS;
  (3) router IU total $7.5346 over 1,624 requests = SQL over the gateway `api_key` rows, PASS; (4) node = detail for the
  iu pool, the router (4,960 picks, $7.58) and review ($68), PASS; (5) Athena only in its own section, absent from
  Explore's "all", 0 Athena gateway rows, PASS; (6) v6 deleted, `make check` green in both repos, shots light and dark at
  1440 and 390 through `@verifier` (two rounds; the second confirmed all seven polish fixes), PASS. `agw review` on every
  non-doc PR: #212 and #216 came back actionable and were fixed before merge (picks availability, IU = billing iu,
  bounded twin CTEs, Athena leak in pace, purpose `other` in the bars), the rest clean. Live origin proof: fresh gateway
  rows carry `lane_detail.origin = claude-code`.
- **Live reading.** Verdict **over** (thin, 20 h window): R $77/d, iu dry 3 Nov ~21:00 UTC, me dry 4 Nov ~22:00 UTC,
  spill 16 days ≈ $1,239 of Claude work at list price until iu renews 21 Nov; Claude on IU since the cutover $0.004;
  personal key $582 / $500, under around 13 Nov.
- **Open, not done.** (1) The 383 `agent-workflows` duplicate rows of 2 Nov (and Wave 3's 34) stay counted in
  `usage.records_unique` (owner's call, agw PLAN Wave 8); only `/usage/demand` drops them (same run, model, step), so the
  IU personal *tracked* figure of 2 Nov carries ~$5. (2) Route-fallback marker: `model-call.ts`, prose-review and the podcast
  fallbacks send the refused id; the OpenCode fallback session and `ocr` send `unknown`; `ocr` sends no `x-agw-origin`.
  `routeFallbackMeasured` reads false until the first fallback happens. (3) Insights are template sentences only, no
  `agw digest` wording; `mover`, `cost-per-run` and `cache-drop` stay silent until the gateway has a previous period (9 Nov).
  (4) Spec decision 5 (production pacing) deferred to 7 days of data; me2 reads "not enabled" until its key and
  `cycleDay` are claimed (Gap 8, owner). (5) Design P2s the reviewer left: near-identical grey swatches for `verify` /
  `other` in the agw-on-credit legend, the Athena warn word on its own line, renewal labels 14 px apart at 390; the
  `basalt-ui shot` harness here writes no `metrics.json`, so the reviewer could not score contrast or empty ratio.
- **Gate changes made on the way.** `make check` runs the API unit tests with `--timeout 30000` (`9d63c90b`) and the
  `tracedFetch` idle-watchdog test runs at 10× its timings (`37e3cd45`): at load average 50–100 from other fleets both
  failed every merge-train run on code this wave never touched. The train check used was
  `(make check || make check) && (bun run test:api --timeout 30000 || …)`.
- **Retro.** The seam stubs (`49766225`: empty Explore/Subscription/IuKey components with fixed props on master) let
  two frontend workers build in parallel without a broken tree; repeat it. Two cross-PR breaks only showed after
  rebase (#212 vs #213 `usage.ts`, `flow-fixtures` vs `lastRequestAt`): give one worker the registration lines. Workers
  twice ended turns on background shells despite the brief; the wait note plus a nudge recovered both. Briefs:
  `docs/waves/briefs/w8-*.md`.
