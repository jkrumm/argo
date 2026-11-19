# API database: db:sync and table notes

Moved from `apps/api/AGENTS.md` §Database. Read before changing `scripts/db-sync.sh`, or before dropping or reviving a table.

## Local dev: db:sync

`make db-sync` dumps the live `argo` schema on the mini (over `ssh mini`) from one REPEATABLE READ READ ONLY snapshot,
the session pinned to `default_transaction_read_only=on` (dump plus per-table row count and md5 taken together), restores it
locally as role `argo` in one transaction and fails unless every table matches. It marks the local schema `argo dev copy`,
drops local tables the source no longer has, refuses a schema marked `argo live` and, independently, a target that is the source database (same cluster `system_identifier` and connected database, checked before the dump), with no override, and replaces a schema without the dev-copy mark only
with `FORCE=1`. `SOURCE_SSH=local TARGET_DB=<scratch>` runs both sides on one host (how it is tested on the mini).

## Tables

All tables are declared under `pgSchema('argo')` in `src/db/schema.ts`. `agent_overview_snapshots`, `agent_narratives` and `agent_review_stats_snapshots` are unused (their `/agents/*` API is gone; the factory's own pages live in the Console) and stay pending a cleanup migration. The five legacy usage tables (`usage_record`, `quota_sample`, `account_pick`, `iu_portal_cost`, `iu_portal_total`) were dropped by migration `0032`; the cutover dump and the nightly backups keep their data.
