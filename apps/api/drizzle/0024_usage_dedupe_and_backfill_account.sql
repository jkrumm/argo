-- Reversible: every row this migration deletes or re-accounts is copied, in full, into
-- argo.usage_record_dedupe_0024 first. Restore SQL: docs/usage-reconciliation.md. The table is
-- deliberately outside the drizzle schema and is dropped by migration 0025; restore from the dump.
CREATE TABLE IF NOT EXISTS "argo"."usage_record_dedupe_0024" (
	LIKE "argo"."usage_record",
	"reason" text NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- 1. Rows ingested before the `machine` column existed (machine IS NULL) were re-pushed once the
--    tracker backfilled it, and the (source, source_id, machine) key treats NULL as distinct, so the
--    same event now exists twice and every chart counts it twice. Archive, then drop, the NULL-machine
--    copy where a machine-bearing twin with identical content exists.
WITH removed AS (
  DELETE FROM "argo"."usage_record" a
  USING "argo"."usage_record" b
  WHERE a."machine" IS NULL
    AND b."machine" IS NOT NULL
    AND a."source" = b."source"
    AND a."source_id" = b."source_id"
    AND a."ts" = b."ts"
    AND a."input_tokens" = b."input_tokens"
    AND a."output_tokens" = b."output_tokens"
    AND a."cache_read_tokens" = b."cache_read_tokens"
    AND a."cache_write_tokens" = b."cache_write_tokens"
    AND a."billing" = b."billing"
    AND a."cost_usd" IS NOT DISTINCT FROM b."cost_usd"
    AND a."model" IS NOT DISTINCT FROM b."model"
  RETURNING a.*
)
INSERT INTO "argo"."usage_record_dedupe_0024"
SELECT removed.*, 'duplicate_null_machine', now() FROM removed;
--> statement-breakpoint
-- 2. Max rows older than the first Max `me` row cannot belong to `me` (the second subscription did not
--    exist yet), and the tracker's `resync-account` backfill only reaches rows still in its local DB,
--    so rows it no longer holds stay account-less. They were all paid by `iu`. A database without any
--    Max `me` row is left alone (the subquery is NULL). Archive the pre-update row, then update it.
INSERT INTO "argo"."usage_record_dedupe_0024"
SELECT u.*, 'account_backfill', now()
FROM "argo"."usage_record" u
WHERE u."billing" = 'max'
  AND u."account" IS NULL
  AND u."ts" < (SELECT min("ts") FROM "argo"."usage_record" WHERE "billing" = 'max' AND "account" = 'me');
--> statement-breakpoint
UPDATE "argo"."usage_record"
SET "account" = 'iu'
WHERE "billing" = 'max'
  AND "account" IS NULL
  AND "ts" < (SELECT min("ts") FROM "argo"."usage_record" WHERE "billing" = 'max' AND "account" = 'me');
