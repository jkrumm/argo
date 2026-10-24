-- 1. Rows ingested before the `machine` column existed (machine IS NULL) were re-pushed once the
--    tracker backfilled it, and the (source, source_id, machine) key treats NULL as distinct, so the
--    same event now exists twice and every chart counts it twice. Drop the NULL-machine copy where a
--    machine-bearing twin with identical content exists.
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
  AND a."cache_write_tokens" = b."cache_write_tokens";
--> statement-breakpoint
-- 2. Max rows older than the first `me` row cannot belong to `me` (the second subscription did not
--    exist yet), and the tracker's `resync-account` backfill only reaches rows still in its local DB,
--    so rows it no longer holds stay account-less. They were all paid by `iu`. A database without any
--    `me` row is left alone (the subquery is NULL).
UPDATE "argo"."usage_record"
SET "account" = 'iu'
WHERE "billing" = 'max'
  AND "account" IS NULL
  AND "ts" < (SELECT min("ts") FROM "argo"."usage_record" WHERE "account" = 'me');
