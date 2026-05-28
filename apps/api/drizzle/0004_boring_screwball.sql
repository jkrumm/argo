DROP INDEX IF EXISTS "uq_usage_source_sourceid";--> statement-breakpoint
ALTER TABLE "argo"."usage_record" ADD COLUMN "sub_tool" text;--> statement-breakpoint
ALTER TABLE "argo"."usage_record" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "argo"."usage_record" ADD COLUMN "received_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_usage_source_sourceid_machine" ON "argo"."usage_record" USING btree ("source","source_id","machine") NULLS NOT DISTINCT;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_machine" ON "argo"."usage_record" USING btree ("machine");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_sub_tool" ON "argo"."usage_record" USING btree ("sub_tool");