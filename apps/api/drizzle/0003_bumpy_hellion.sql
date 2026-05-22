CREATE TABLE IF NOT EXISTS "argo"."usage_record" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"grain" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"model" text,
	"model_norm" text,
	"project" text,
	"billing" text NOT NULL,
	"machine" text,
	"outcome" text DEFAULT 'ok' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real,
	"cost_source" text DEFAULT 'none' NOT NULL,
	"raw" jsonb,
	"ingested_at" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_usage_source_sourceid" ON "argo"."usage_record" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_ts" ON "argo"."usage_record" USING btree ("ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_source" ON "argo"."usage_record" USING btree ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_model_norm" ON "argo"."usage_record" USING btree ("model_norm");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_billing" ON "argo"."usage_record" USING btree ("billing");