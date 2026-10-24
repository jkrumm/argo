ALTER TABLE "argo"."usage_record" ADD COLUMN "account" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_account" ON "argo"."usage_record" USING btree ("account");