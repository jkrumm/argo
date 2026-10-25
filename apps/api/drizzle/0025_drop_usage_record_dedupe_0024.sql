-- Retires the migration-0024 archive table (24,803 duplicate_null_machine + 7,165 account_backfill
-- rows). 0024 and its 48 h reconciliation are verified clean. The restore path is the pg_dump
-- described in docs/usage-reconciliation.md, not this table.
DROP TABLE IF EXISTS "argo"."usage_record_dedupe_0024";
