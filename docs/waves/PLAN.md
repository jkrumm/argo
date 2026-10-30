# Argo on the mini, usage v2

**Goal:** Argo runs natively on the mini against the shared Postgres, usage lands in the `usage` schema with sessions
as an entity and no hand-kept prices, Kuma pulls the mini's health through one door, and the VPS no longer runs Argo.
Decisions: `software-factory/docs/decisions.md` (SF8, A1–A4, U1–U5); findings and order:
`software-factory/docs/program.md` §A1; data model boundary: `software-factory/docs/design.md` §9, §11; prices:
`software-factory/docs/research/2026-10-30-price-catalog.md`.
**Gate:** per wave, `make check` in every repo it touched and `/review` on the non-doc changes; from the wave that
deploys, `make verify` on the mini. Nothing leaves the VPS until its replacement is verified live. Own-repo pushes
and deploys are routine.

## Wave 1 — The shared database and the usage schema            <!-- status: active -->
Workers: Sonnet. Orchestrated: do NOT spawn Wave 2.

- [ ] **Database `shared`** on the mini's main Postgres 18, created idempotently by a target (`make db-shared` here or
  in dotfiles, your call; software-factory's F1 will call the same one, so name it in Left behind). A role per writer
  (`usage`, `argo`, later `factory`), each owning its schema, each with its own connection limit. Passwords in 1Password,
  seeded through `dotfiles-private/headless.refs`. `agent_workflows` stays separate; add a read-only role there for
  Argo (A5).
- [ ] **Backups:** a nightly `pg_dump` of `shared` to the homelab, a Kuma push on success, and a restore drill proved
  once. Reuse whatever pattern the mini's backups already follow.
- [ ] **Schema v2 in `usage`,** migrations owned by usage-tracker: sessions as an entity with their lane (interactive,
  wave mother, lead or worker, fan worker, subagent type, Hermes, iris, agw workflow, step and route), account,
  subscription or API key, machine, model, effort, repo, `issue_id`, `run_id` (U2); records keyed `(source, source_id)`
  with machine as an attribute (U4); all five token kinds, `cache_write_1h` included. Repo is the directory name under
  `~/SourceRoot`, the same slug as `factory.projects`; normalise from today's 6,376 raw values. Window share per
  session is the headline (U5): store what it needs.
- [ ] **`prices`, effective-dated (U3):** a daily sync from LiteLLM's `model_prices_and_context_window.json`, OpenRouter
  as fallback for a model LiteLLM lacks. No catalog publishes history: snapshot, stamp `valid_from`, write a row only on
  change, and seed history from the file's git log. Precedence: provider-reported cost, then `prices`, then a manual
  override table. Checks the research left open: whether LiteLLM carries Haiku 5.5's 100k-token tier and DeepSeek's
  off-peak rates; compare the Claude 5 family against Anthropic's published table once.
- [ ] Verify: the schema migrates from empty twice, the sync runs twice with one row per change, a known model prices
  correctly for all five token kinds.

**Left behind:**

## Wave 2 — usage-tracker writes `usage` directly            <!-- status: pending -->
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
