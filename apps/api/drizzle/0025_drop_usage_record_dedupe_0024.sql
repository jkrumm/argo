-- Retires the migration-0024 archive table. It was archive-only; the restore path is the pg_dump
-- described in docs/usage-reconciliation.md.
DROP TABLE IF EXISTS "argo"."usage_record_dedupe_0024";
