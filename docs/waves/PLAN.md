# Argo on the mini, usage v2

**Goal:** Argo runs natively on the mini against the shared Postgres, usage lands in the `usage` schema with sessions
as an entity and no hand-kept prices, Kuma pulls the mini's health through one door, and the VPS no longer runs Argo.
Decisions: `software-factory/docs/decisions.md` (SF8, A1–A4, U1–U5); findings and order:
`software-factory/docs/program.md` §A1; data model boundary: `software-factory/docs/design.md` §9, §11; prices:
`software-factory/docs/research/2026-10-30-price-catalog.md`.
**Gate:** per wave, `make check` in every repo it touched and `/review` on the non-doc changes; from the wave that
deploys, `make verify` on the mini. Nothing leaves the VPS until its replacement is verified live. Own-repo pushes
and deploys are routine.

## Wave 1 — The shared database and the usage schema            <!-- status: done -->
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

## Wave 2 — usage-tracker writes `usage` directly            <!-- status: active -->
Workers: Sonnet. Orchestrated.

- [ ] usage-tracker inserts into the `usage` schema (U1); its SQLite staging and 15-minute sync to Argo go, the pricing
  in `src/pricing.ts` goes. Argo's copy (`lib/ai-usage.ts`) stays until Wave 3.
- [ ] Backfill history once from `argo.usage_record` on the VPS: the $3,081 of duplicates from the old key disappear by
  the new key; prove totals per source and month against the old table and explain every difference. The VPS table is
  not touched.
- [ ] `agw`'s usage outbox targets the same table (agent-workflows); run dedup across both writers.
- [ ] Company API spend reconciled to portal actuals per key and day; 1,631 unpriced IU rows priced or explained.

**Left behind:**

## Wave 3 — Argo reads the shared database            <!-- status: pending -->
Workers: Sonnet. Orchestrated.

- [ ] Argo's usage pages read `usage`; `lib/ai-usage.ts` pricing and the ingest endpoint go.
- [ ] Argo's own schema moves to `shared` on the mini: a dump from the VPS, restored, row counts and checksums proved.
  While Argo still runs on the VPS, it keeps the VPS database; this step is a rehearsal the cutover repeats.
- [ ] Delete what has no caller: `/ai/v1/*` HTTP routes (`aiComplete` stays), `startChatTurn`, the 50 MB body limit if no
  route needs it, the unused `@elysiajs/bearer` and `@hey-api/client-fetch`.

**Left behind:**

## Wave 4 — Argo native on the mini            <!-- status: pending -->
Workers: Sonnet. Orchestrated.

- [ ] Native like agw (A1): release directories, launchd, rollback, `make deploy|verify`, no Docker, no RollHook. OTel to
  ClickStack's authed tier. The OAuth token files move with `DATA_DIR`.
- [ ] Bridges flip to loopback: agw overview push and usage outbox, Hermes narratives. VPS callers (email-gateway usage
  posts) get a port-scoped VPS → mini grant, the same pattern as weatherorb's.
- [ ] The dashboard reachable as today, every page loads, on the rehearsal data.

**Left behind:**

## Wave 5 — The Kuma door            <!-- status: pending -->
Workers: Sonnet. Orchestrated.

- [ ] One tailnet port on the mini, granted to the homelab only (A3). A registry in dotfiles maps a name to a local
  health URL; `GET /h/<name>` returns the status and a capped body, GET only. Kuma's monitors are generated from the
  same registry. Push stays for jobs.

**Left behind:**

## Wave 6 — Cutover            <!-- status: pending -->
Workers: Sonnet. Orchestrated.

- [ ] Final dump, restore, DNS or tunnel switched, `make verify`, every page once.
- [ ] VPS Argo stopped; its database kept, stopped, with a verified final backup on the homelab. Dropping it is a
  business decision and goes to the owner through `ask-human.sh`.
- [ ] ADR-009's VPS role retired; `docs/`, `vps/AGENTS.md`, `docs/architecture.md` in dotfiles say what runs.

**Left behind:**
