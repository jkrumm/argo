-- One weight entry per day: the POST used select-then-insert, so a double submit stored two rows.
-- Keep the latest row (highest id) per date, then enforce it. The dedupe is idempotent and a no-op
-- on a clean table.
DELETE FROM "argo"."weight_log" a USING "argo"."weight_log" b WHERE a."date" = b."date" AND a."id" < b."id";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "weight_log_date_uq" ON "argo"."weight_log" USING btree ("date");
